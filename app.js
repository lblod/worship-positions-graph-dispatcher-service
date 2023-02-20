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
  getSubjectsToDispatchAfterIngestOfSubject
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

  if (!delta.inserts.length) {
    console.log(
      "Delta does not contain any insertions. Nothing should happen."
    );
    return res.status(204).send();
  }

  const inserts = delta.inserts;
  const subjects = inserts.map(insert => insert.subject.value);
  const uniqueSubjects = [ ...new Set(subjects) ];

  for (const subject of uniqueSubjects) {
    // Ensuring we only process a subject when necessary to keep the queue as small as possible
    if (!PROCESS_SUBJECT_QUEUE.hasJobForSubject(subject)) {
      PROCESS_SUBJECT_QUEUE.addJob(subject, () => processSubject(subject));
    }
  }
  return res.status(200).send();
});

async function processSubject(subject) {
  try {
    const types = await getTypesForSubject(subject);

    const matchingPublicConfigs = dispatchToPublicGraphConfig.filter(config => types.find(type => type == config.type));
    const matchingOrgConfigs = dispatchToOrgGraphsConfig.filter(config => types.find(type => type == config.type));

    for (const config of matchingPublicConfigs) {
      const canBePublic = await isSubjectPublicAfterAdditionalFilters(subject, config);

      if (canBePublic) {
        if (config.type == REPRESENTATIVE_ORGAN_TYPE) {
          // ROs need a special treatment, they need extra triples to function with acmidm
          await insertRepresentativeOrganExtraTriples(subject);
        }

        // Ensuring we only dispatch data of a worship admin unit when necessary to keep the queue as small as possible
        if (!DISPATCH_PUBLIC_SUBJECTS_QUEUE.hasJobForSubject(subject)) {
          DISPATCH_PUBLIC_SUBJECTS_QUEUE.addJob(subject, () => dispatchToPublicGraph(subject));
        }

        if (config.subjectsToDispatchAfterIngest) {
          // We need to see if some subjects need to be re-evaluated. In some cases, they gave an additional filter that
          // depends on other data types
          const subjects = await getSubjectsToDispatchAfterIngestOfSubject(subject, config.subjectsToDispatchAfterIngest);
          subjects.forEach(subject => DISPATCH_PUBLIC_SUBJECTS_QUEUE.addJob(subject, () => dispatchToPublicGraph(subject)));
        }
      }
    }

    for (const config of matchingOrgConfigs) {
      const worshipAdministrativeUnit = await getWorshipAdministrativeUnitForSubject(subject, config);
      if (worshipAdministrativeUnit) {
        // Ensuring we only dispatch data of a worship admin unit when necessary to keep the queue as small as possible
        if (!DISPATCH_ORG_SUBJECTS_QUEUE.hasJobForSubject(worshipAdministrativeUnit)) {
          DISPATCH_ORG_SUBJECTS_QUEUE.addJob(worshipAdministrativeUnit, () => dispatchToOrgGraphs(worshipAdministrativeUnit));
        }
      }
    }
  } catch (e) {
    console.error(`Error while processing a subject: ${e.message ? e.message : e}`);
    await sendErrorAlert({
      message: `Something unexpected went wrong while processing a subject: ${e.message ? e.message : e}`
    });
  }
}

async function dispatchToPublicGraph(subject) {
  await copySubjectDataToDestinationGraphs(subject, [PUBLIC_GRAPH]);
}

async function dispatchToOrgGraphs(worshipAdministrativeUnit) {
  const destinationGraphs = await getDestinationGraphs(worshipAdministrativeUnit);
  if (destinationGraphs.length) {
    let subjects = [worshipAdministrativeUnit];
    for (const config of dispatchToOrgGraphsConfig) {
      const relatedSubjects = await getRelatedSubjectsForWorshipAdministrativeUnit(
        worshipAdministrativeUnit,
        config.type,
        config.pathToWorshipAdminUnit
      );
      subjects.push(...relatedSubjects);
    }

    for(const subject of subjects) {
      await copySubjectDataToDestinationGraphs(subject, destinationGraphs);
    }
  }
}
