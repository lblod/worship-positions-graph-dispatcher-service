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
  getRelatedSubjectsForWorshipAdministrativeUnit
} from "./util/queries";
import exportConfig from "./export-config";

const processSubjectsQueue = new ProcessingQueue('worship-positions-process-queue');
const dispatchSubjectsQueue = new ProcessingQueue('worship-positions-dispatch-queue');

app.use(
  bodyParser.json({
    type: function (req) {
      return /^application\/json/.test(req.get("content-type"));
    }
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
    if (!processSubjectsQueue.hasJobForSubject(subject)) {
      processSubjectsQueue.addJob(subject, () => processSubject(subject));
    }
  }
  return res.status(200).send();
});

async function processSubject(subject) {
  try {
    const types = await getTypesForSubject(subject);

    for(const type of types) {
      try {
        const worshipAdministrativeUnit = await getWorshipAdministrativeUnitForSubject(subject, type);
        if (worshipAdministrativeUnit) {
          // Ensuring we only dispatch data of a worship admin unit when necessary to keep the queue as small as possible
          if (!dispatchSubjectsQueue.hasJobForSubject(worshipAdministrativeUnit)) {
            dispatchSubjectsQueue.addJob(worshipAdministrativeUnit, () => dispatch(worshipAdministrativeUnit));
          }
        }
      }
      catch (e) {
        console.error(`Error while processing a subject ${subject}: ${e.message ? e.message : e}`);
        await sendErrorAlert({
          message: `Error while processing a subject ${subject}: ${e.message ? e.message : e}`
        });
      }
    }
  } catch (e) {
    console.error(`Error while processing a subject: ${e.message ? e.message : e}`);
    await sendErrorAlert({
      message: `Something unexpected went wrong while processing a subject: ${e.message ? e.message : e}`
    });
  }
}

async function dispatch(worshipAdministrativeUnit) {
  const destinationGraphs = await getDestinationGraphs(worshipAdministrativeUnit);
  let subjects = [worshipAdministrativeUnit];
  for (const config of exportConfig) {
    const subject = await getRelatedSubjectsForWorshipAdministrativeUnit(
      worshipAdministrativeUnit,
      config.type,
      config.pathToWorshipAdminUnit
    );
    subjects.push(...subject);
  }

  for(const subject of subjects) {
    await copySubjectDataToDestinationGraphs(subject, destinationGraphs);
  }
}
