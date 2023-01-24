import { sparqlEscapeUri, sparqlEscapeString, sparqlEscapeDateTime, uuid } from "mu";
import { querySudo as query, updateSudo as update } from "@lblod/mu-auth-sudo";
import exportConfig from "../export-config";
import { parseResult } from './utils';
import { DISPATCH_SOURCE_GRAPH } from '../config';

const CREATOR = 'http://lblod.data.gift/services/worship-positions-graph-dispatcher-service';

export async function getRelatedSubjectsForWorshipAdministrativeUnit(
  worshipAdministrativeUnit,
  subjectType,
  pathToWorshipAdminUnit,
  destinationGraphs
) {
  const queryStr = `
    SELECT DISTINCT ?g ?subject WHERE {
      BIND(${sparqlEscapeUri(worshipAdministrativeUnit)} as ?worshipAdministrativeUnit)
      ?subject a ${sparqlEscapeUri(subjectType)}.

      GRAPH ?g {
        ?subject ?p ?o .
      }
      ${pathToWorshipAdminUnit}
    }
  `;

  const result = await query(queryStr);
  return result.results.bindings
    .filter(r => {
      return destinationGraphs.find(g => g != r.g.value);
    })
    .map(r => r.subject.value);
}

export async function getTypesForSubject(subject) {
  const configuredTypes = exportConfig.map(c => sparqlEscapeUri(c.type)).join('\n');

  const queryStr = `
    SELECT DISTINCT ?type {
      VALUES ?type {
        ${configuredTypes}
      }
      ${sparqlEscapeUri(subject)} a ?type.
    }
  `;

  return (await query(queryStr)).results.bindings.map(r => r.type.value);
}

export async function getWorshipAdministrativeUnitForSubject(subject, type) {
  const configs = exportConfig.filter(c => c.type == type);
  for(const config of configs) {
    const queryStr = `
      SELECT DISTINCT ?worshipAdministrativeUnit WHERE {
        BIND(${sparqlEscapeUri(subject)} as ?subject)

        ?subject a ${sparqlEscapeUri(config.type)}.
        ${config.pathToWorshipAdminUnit}
      }
    `;

    const bindings = (await query(queryStr)).results.bindings;

    if(bindings.length) {
      return bindings[0].worshipAdministrativeUnit.value;
    }
  }
  return null;
}

export async function getDestinationGraphs(worshipAdministrativeUnit) {
  const queryStr = `
    SELECT DISTINCT ?graph WHERE {
      GRAPH ?graph {
        ${sparqlEscapeUri(worshipAdministrativeUnit)} ?p ?o .
      }
      FILTER (?graph != ${sparqlEscapeUri(DISPATCH_SOURCE_GRAPH)})
    }
  `;

  const result = await query(queryStr);
  return parseResult(result).map(res => res.graph);
}

export async function copySubjectDataToDestinationGraphs(subject, destinationGraphs) {
  let insertInGraphs = '';
  for (const destinationGraph of destinationGraphs) {
    insertInGraphs += `
      GRAPH ${sparqlEscapeUri(destinationGraph)} {
        ?s ?p ?o.
      }
    `;
  }

  const queryStr = `
    DELETE {
      GRAPH ${sparqlEscapeUri(DISPATCH_SOURCE_GRAPH)} {
        ?s ?p ?o.
      }
    }
    INSERT {
      ${insertInGraphs}
    }
    WHERE {
      BIND(${sparqlEscapeUri(subject)} as ?s)
      ?s ?p ?o.
    }
  `;
  await update(queryStr);

}

export async function sendErrorAlert({message, detail, reference}) {
  if (!message)
    throw 'Error needs a message describing what went wrong.';
  const id = uuid();
  const uri = `http://data.lblod.info/errors/${id}`;
  const q = `
      PREFIX mu:   <http://mu.semte.ch/vocabularies/core/>
      PREFIX oslc: <http://open-services.net/ns/core#>
      PREFIX dct:  <http://purl.org/dc/terms/>
      INSERT DATA {
        GRAPH <http://mu.semte.ch/graphs/error> {
            ${sparqlEscapeUri(uri)} a oslc:Error ;
                    mu:uuid ${sparqlEscapeString(id)} ;
                    dct:subject ${sparqlEscapeString('Dispatch worship positions')} ;
                    oslc:message ${sparqlEscapeString(message)} ;
                    dct:created ${sparqlEscapeDateTime(new Date().toISOString())} ;
                    dct:creator ${sparqlEscapeUri(CREATOR)} .
            ${reference ? `${sparqlEscapeUri(uri)} dct:references ${sparqlEscapeUri(reference)} .` : ''}
            ${detail ? `${sparqlEscapeUri(uri)} oslc:largePreview ${sparqlEscapeString(detail)} .` : ''}
        }
      }
  `;
  try {
    await update(q);
  } catch (e) {
    console.error(`[WARN] Something went wrong while trying to store an error.\nMessage: ${e}\nQuery: ${q}`);
  }
}
