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

const processSubjectsQueue = new ProcessingQueue('worship-positions-dispatch-queue');

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

  for(const subject of uniqueSubjects) {
    processSubjectsQueue.addJob(() => processSubject(subject));
  }
  return res.status(200).send();
});

async function processSubject(subject) {
  try {
    const types = await getTypesForSubject(subject);

    for(const type of types) {
      try {
        const worshipAdministrativeUnit = await getWorshipAdministrativeUnitForSubject(subject, type);
        if(worshipAdministrativeUnit) {
          await dispatch(subject, worshipAdministrativeUnit);
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

async function dispatch(subject, worshipAdministrativeUnit) {
  const destinationGraphs = await getDestinationGraphs(worshipAdministrativeUnit);

  let subjects = [];
  for (const config of exportConfig) {
    subjects = await getRelatedSubjectsForWorshipAdministrativeUnit(
      subject,
      config.type,
      config.pathToWorshipAdminUnit
    );
  }

  for(const subject of subjects) {
    await copySubjectDataToDestinationGraphs(subject, destinationGraphs);
  }
}
