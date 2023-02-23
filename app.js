import bodyParser from "body-parser";
import { app } from "mu";
import { Delta } from "./lib/delta";
import { ProcessingQueue } from './lib/processing-queue';
import {
  sendErrorAlert,
  getTypesForSubject,
  getWorshipAdministrativeUnitForSubject,
  getDestinationGraphs,
  copySubjectDataToDestinationGraphs,
  getRelatedSubjectsForWorshipAdministrativeUnit,
  isSubjectPublicAfterAdditionalFilters,
  insertRepresentativeOrganExtraTriples,
  getSubjectsToRedispatchToPublicGraph,
  getSubjectsToRedispatchToOrgGraph
} from "./util/queries";
import {
  dispatchToOrgGraphsConfig,
  dispatchToPublicGraphConfig
} from "./dispatch-config";
import { PUBLIC_GRAPH } from "./config"

const PROCESS_SUBJECT_QUEUE = new ProcessingQueue('worship-positions-process-queue');
const DISPATCH_PUBLIC_SUBJECTS_QUEUE = new ProcessingQueue('worship-positions-public-dispatch-queue');
const DISPATCH_ORG_SUBJECTS_QUEUE = new ProcessingQueue('worship-positions-org-dispatch-queue');

const REPRESENTATIVE_ORGAN_TYPE = 'http://data.lblod.info/vocabularies/erediensten/RepresentatiefOrgaan';

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

  let insertSubjects = [];
  let deleteSubjects = [];
  let uniqueSubjects = [];

  // All inserts trigger the dispatching mechanism
  const inserts = delta.inserts;
  if (inserts && inserts.length) {
    insertSubjects = inserts.map(insert => insert.subject.value);
  }

  // Some deletes as well: the deletes that might impact who can see which worship admin unit
  // In this special case it happens when a link between a RO and a worship admin unit gets deleted,
  // or when the link between a betrokken lokale bestuur and a worship admin unit gets deleted.
  const deletes = delta.deletes;
  if (deletes && deletes.length) {
    let filteredDeletes = deletes.filter(triple => triple.predicate.value == "http://www.w3.org/ns/org#linkedTo" ||
      triple.predicate.value == "http://www.w3.org/ns/org#organization"
    );
    deleteSubjects = filteredDeletes.map(triple => triple.subject.value);
  }

  uniqueSubjects.push(...new Set(insertSubjects), ...new Set(deleteSubjects));

  for (const subject of uniqueSubjects) {
    // Ensuring we only process a subject when necessary to keep the queue as small as possible
    if (!PROCESS_SUBJECT_QUEUE.hasJobForSubject(subject)) {
      PROCESS_SUBJECT_QUEUE.addJob(subject, () => processSubject(subject));
    }
  }
  return res.status(200).send();
});

// ----------------------------------------------------------------------
// ------------------------------ INTERNAL ------------------------------
// ----------------------------------------------------------------------

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

      // Ensuring we only dispatch data of a worship admin unit when necessary to keep the queue as small as possible
      if (!DISPATCH_PUBLIC_SUBJECTS_QUEUE.hasJobForSubject(subject)) {
        DISPATCH_PUBLIC_SUBJECTS_QUEUE.addJob(subject, () => dispatchToPublicGraph(subject, config));
      }
    }
  }
}

async function processOrgSubject(subject, matchingOrgConfigs) {
  for (const config of matchingOrgConfigs) {
    const worshipAdministrativeUnit = await getWorshipAdministrativeUnitForSubject(subject, config);
    if (worshipAdministrativeUnit) {
      // Ensuring we only dispatch data of a worship admin unit when necessary to keep the queue as small as possible
      if (!DISPATCH_ORG_SUBJECTS_QUEUE.hasJobForSubject(worshipAdministrativeUnit)) {
        DISPATCH_ORG_SUBJECTS_QUEUE.addJob(worshipAdministrativeUnit, () => dispatchToOrgGraphs(worshipAdministrativeUnit));
      }
    }
  }
}

async function dispatchToPublicGraph(subject, config) {
  await copySubjectDataToDestinationGraphs(subject, [PUBLIC_GRAPH]);

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
      if (!PROCESS_SUBJECT_QUEUE.hasJobForSubject(subject)) {
        PROCESS_SUBJECT_QUEUE.addJob(subject, () => processSubject(subject));
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
      if (!PROCESS_SUBJECT_QUEUE.hasJobForSubject(subject)) {
        PROCESS_SUBJECT_QUEUE.addJob(subject, () => processSubject(subject));
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
      await copySubjectDataToDestinationGraphs(subject, destinationGraphs);
    }
  }
}
