import bodyParser from "body-parser";
import { app } from "mu";
import { Delta } from "./lib/delta";
import { ProcessingQueue } from './lib/processing-queue';
import { Prerequisite } from "./lib/prerequisite";
import {
  sendErrorAlert,
  getTypesForSubject,
  getWorshipAdministrativeUnitForSubject,
  getDestinationGraphs,
  moveSubjectDataToDestinationGraphs,
  getRelatedSubjectsForWorshipAdministrativeUnit,
  isSubjectPublicAfterAdditionalFilters,
  insertRepresentativeOrganExtraTriples,
  insertKboForAcmidm,
  getSubjectsToRedispatchToOrgGraph,
  getSubjectsToRedispatchToPublicGraph,
  getSubjectsInDispatchSourceGraphByTypes
} from "./lib/queries";
import {
  dispatchToOrgGraphsConfig,
  dispatchToPublicGraphConfig
} from "./dispatch-config";
import { PUBLIC_GRAPH, DISPATCH_SOURCE_GRAPH } from "./config"

const PROCESSING_QUEUE = new ProcessingQueue('worship-positions-process-queue', {
  prerequisite: new Prerequisite()
});

const REPRESENTATIVE_ORGAN_TYPE = 'http://data.lblod.info/vocabularies/erediensten/RepresentatiefOrgaan';
const STRUCTURED_IDENTIFIER_TYPE = 'https://data.vlaanderen.be/ns/generiek#GestructureerdeIdentificator';

app.use(
  bodyParser.json({
    type: function (req) {
      return /^application\/json/.test(req.get("content-type"));
    },
    limit: '50mb',
    extended: true
  })
);

app.use(
  bodyParser.urlencoded({
    type: function (req) {
      return /^application\/json/.test(req.get("content-type"));
    },
    limit: '50mb',
    extended: true
  })
);

app.get("/", function (req, res) {
  res.send("Hello from worship-positions-graph-dispatcher-service");
});

app.post("/delta", async function (req, res) {
  const delta = new Delta(req.body);

  const inserts = delta.inserts;
  const deletes = delta.deletes;
  const subjects = [...inserts.map(insert => insert.subject.value), ...deletes.map(insert => insert.subject.value)];
  const uniqueSubjects = [ ...new Set(subjects) ];

  for (const subject of uniqueSubjects) {
    // Ensuring we only process a subject when necessary to keep the queue as small as possible
    if (!PROCESSING_QUEUE.hasJobForSubject(subject)) {
      PROCESSING_QUEUE.addJob(subject, () => processSubject(subject));
    }
  }
  return res.status(200).send();
});

/***********************************************
 * DEBUG/RESCUE ENDPOINTS
 * Not meant to be exposed.
 ***********************************************/

/**
 * Triggers the dispatch process manually.
 * This is intended for scenarios such as debugging, restarting failed initial syncs,
 * or re-dispatching subjects that encountered issues during dispatching.
 *
 * The dispatch logic itself takes care of clearing data from non-source graphs
 * before re-inserting, so a re-run is sufficient to correct misplaced data.
 *
 * @route POST /manual-dispatch
 * @param {string} [subject] - The URI of a specific subject to (re-)dispatch.
 *   Takes precedence over `type` if both are provided.
 * @param {string} [type] - A configured dispatch type URI. If provided, only
 *   subjects of that type in DISPATCH_SOURCE_GRAPH will be (re-)dispatched.
 *   Without `subject` and without `type`, every subject in DISPATCH_SOURCE_GRAPH
 *   whose type appears in the dispatch configuration will be (re-)dispatched.
 * @returns {Object} 201 - Empty response indicating dispatch has been scheduled.
 * @returns {Object} 400 - When the supplied `type` isn't a configured dispatch type.
 */
app.post("/manual-dispatch", async function (req, res) {
  let scheduled = 0;
  if (req.query.subject) {
    const subject = req.query.subject;
    console.log(`Only one subject to (re-)dispatch: ${subject}`);
    if (!PROCESSING_QUEUE.hasJobForSubject(subject)) {
      PROCESSING_QUEUE.addJob(subject, () => processSubject(subject));
      scheduled += 1;
    }
    console.log(`Scheduling done. Newly scheduled: ${scheduled}. Queue size: ${PROCESSING_QUEUE.size()}.`);
    return res.status(201).send();
  }

  const configuredTypes = [
    ...new Set([
      ...dispatchToOrgGraphsConfig.map(c => c.type),
      ...dispatchToPublicGraphConfig.map(c => c.type)
    ])
  ];

  let typesToDispatch;
  if (req.query.type) {
    if (!configuredTypes.includes(req.query.type)) {
      return res.status(400).send({
        message: `Type "${req.query.type}" is not a configured dispatch type.`,
        configuredTypes
      });
    }
    typesToDispatch = [req.query.type];
    console.log(`Dispatching subjects of type ${req.query.type} from GRAPH ${DISPATCH_SOURCE_GRAPH}`);
  } else {
    typesToDispatch = configuredTypes;
    console.log(`Dispatching all configured subjects (again) from GRAPH ${DISPATCH_SOURCE_GRAPH}`);
  }

  const subjects = await getSubjectsInDispatchSourceGraphByTypes(typesToDispatch);
  console.log(`Found ${subjects.length} subjects to (re-)dispatch.`);

  for (const subject of subjects) {
    if (!PROCESSING_QUEUE.hasJobForSubject(subject)) {
      PROCESSING_QUEUE.addJob(subject, () => processSubject(subject));
      scheduled += 1;
    }
  }
  console.log(`Scheduling done. Newly scheduled: ${scheduled}. Queue size: ${PROCESSING_QUEUE.size()}.`);
  return res.status(201).send();
});

/***********************************************
 * END DEBUG/RESCUE ENDPOINTS
 ***********************************************/

/**
 * Processes a subject by finding if it should be dispatched and where
 */
async function processSubject(subject) {
  try {
    // Get the types of the subject
    const types = await getTypesForSubject(subject);

    // Find dispatch configurations for the types found
    const matchingPublicConfigs = dispatchToPublicGraphConfig.filter(config => types.find(type => type == config.type));
    const matchingOrgConfigs = dispatchToOrgGraphsConfig.filter(config => types.find(type => type == config.type));

    await processPublicSubject(subject, matchingPublicConfigs);
    await processOrgSubject(subject, matchingOrgConfigs);
  } catch (e) {
    console.error(`Error while processing a subject: ${e.message ? e.message : e}`);
    await sendErrorAlert({
      message: `Something unexpected went wrong while processing a subject: ${e.message ? e.message : e}`
    });
  }
}

async function processPublicSubject(subject, matchingPublicConfigs) {
  for (const config of matchingPublicConfigs) {
    const canBePublic = await isSubjectPublicAfterAdditionalFilters(subject, config);

    if (canBePublic) {
      if (config.type == REPRESENTATIVE_ORGAN_TYPE) {
        // ROs need a special treatment, they need extra triples to function with acmidm
        await insertRepresentativeOrganExtraTriples(subject);
      }

      if (config.type == STRUCTURED_IDENTIFIER_TYPE) {
        // KBOs need to be modeled differently to fit with acmidm requirements
        await insertKboForAcmidm(subject);
      }

      await dispatchToPublicGraph(subject, config);
    }
  }
}

async function processOrgSubject(subject, matchingOrgConfigs) {
  for (const config of matchingOrgConfigs) {
    const worshipAdministrativeUnit = await getWorshipAdministrativeUnitForSubject(subject, config);
    if (worshipAdministrativeUnit) {
      await dispatchToOrgGraphs(worshipAdministrativeUnit);
    }
  }
}

async function dispatchToPublicGraph(subject, config) {
  await moveSubjectDataToDestinationGraphs(subject, [PUBLIC_GRAPH]);

  // We need to see if some subjects need to be re-evaluated. In some cases, the previously dispatched data
  // can fix broken paths to dispatch other data types
  if (config.triggersPublicRedispatchFor && config.triggersPublicRedispatchFor.length) {
    let subjects = [];
    for (const path of config.triggersPublicRedispatchFor) {
      const newSubjectsToDispatch = await getSubjectsToRedispatchToPublicGraph(subject, path);
      subjects.push(...newSubjectsToDispatch);
    }

    subjects.forEach(subject => {
      // Ensuring we only process data when necessary to keep the queue as small as possible
      if (!PROCESSING_QUEUE.hasJobForSubject(subject)) {
        PROCESSING_QUEUE.addJob(subject, () => processSubject(subject));
      }
    });
  }

  if (config.triggersOrgRedispatchFor && config.triggersOrgRedispatchFor.length) {
    let subjects = [];
    for (const path of config.triggersOrgRedispatchFor) {
      const newSubjectsToDispatch = await getSubjectsToRedispatchToOrgGraph(subject, path);
      subjects.push(...newSubjectsToDispatch);
    }

    subjects.forEach(subject => {
      // Ensuring we only process data when necessary to keep the queue as small as possible
      if (!PROCESSING_QUEUE.hasJobForSubject(subject)) {
        PROCESSING_QUEUE.addJob(subject, () => processSubject(subject));
      }
    });
  }
}

async function dispatchToOrgGraphs(worshipAdministrativeUnit) {
  const destinationGraphs = await getDestinationGraphs(worshipAdministrativeUnit);
  if (destinationGraphs.length) {
    let subjects = [worshipAdministrativeUnit];
    for (const config of dispatchToOrgGraphsConfig) {
      const relatedSubjects = await getRelatedSubjectsForWorshipAdministrativeUnit(
        worshipAdministrativeUnit,
        config.type,
        config.pathToWorshipAdminUnit,
        destinationGraphs
      );
      subjects.push(...relatedSubjects);
    }

    for(const subject of subjects) {
      await moveSubjectDataToDestinationGraphs(subject, destinationGraphs);
    }
  }
}
