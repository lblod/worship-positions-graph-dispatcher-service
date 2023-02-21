import { sparqlEscapeUri, sparqlEscapeString, sparqlEscapeDateTime, uuid } from "mu";
import { querySudo as query, updateSudo as update } from "@lblod/mu-auth-sudo";
import { parseResult } from './utils';
import { DISPATCH_SOURCE_GRAPH } from '../config';

const CREATOR = 'http://lblod.data.gift/services/worship-positions-graph-dispatcher-service';

export async function isSubjectPublicAfterAdditionalFilters(subject, config) {
  if (!config.additionalFilter) {
    return true;
  }

  const existsQuery = `
    ASK {
      BIND(${sparqlEscapeUri(subject)} as ?subject)

      ?subject a ${sparqlEscapeUri(config.type)}.
      ${config.additionalFilter}
    }
  `;

  return (await query(existsQuery)).boolean;
}

export async function getTypesForSubject(subject) {
  const queryStr = `
    SELECT DISTINCT ?type {
      ${sparqlEscapeUri(subject)} a ?type.
    }
  `;

  return (await query(queryStr)).results.bindings.map(r => r.type.value);
}

export async function getWorshipAdministrativeUnitForSubject(subject, config) {
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

  return null;
}

/**
 * We follow some rules to know where private data should be dispatched :
 *   1. Representative organs can see worship services they are related to via org:linkedTo
 *   2. Municipalities and provinces can see worship services they are related to via a
        "betrokken lokale besturen"
 */
export async function getDestinationGraphs(worshipAdministrativeUnit) {
  const queryStr = `
    PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
    PREFIX org: <http://www.w3.org/ns/org#>
    PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#>
    PREFIX ere: <http://data.lblod.info/vocabularies/erediensten/>

    SELECT DISTINCT ?graph WHERE {
      {
        ?ro org:linkedTo ${sparqlEscapeUri(worshipAdministrativeUnit)} ;
          mu:uuid ?uuid .
      }
      UNION
      {
        VALUES ?classification {
          <http://data.vlaanderen.be/id/concept/BestuurseenheidClassificatieCode/5ab0e9b8a3b2ca7c5e000000>
          <http://data.vlaanderen.be/id/concept/BestuurseenheidClassificatieCode/5ab0e9b8a3b2ca7c5e000001>
        }

        ?betrokke org:organization ${sparqlEscapeUri(worshipAdministrativeUnit)} .

        ?s a besluit:Bestuurseenheid ;
          mu:uuid ?uuid ;
          org:classification ?classification ;
          ere:betrokkenBestuur ?betrokke .
      }
      BIND(IRI(CONCAT("http://mu.semte.ch/graphs/organizations/", ?uuid, "/LoketLB-eredienstOrganisatiesGebruiker")) AS ?graph)
    }
  `;

  const result = await query(queryStr);
  return parseResult(result).map(res => res.graph);
}

/**
 * Get the subjects which have some triples to move in org graphs (MINUS helps us to get this subset)
 */
export async function getRelatedSubjectsForWorshipAdministrativeUnit(
  worshipAdministrativeUnit,
  subjectType,
  pathToWorshipAdminUnit,
) {
  const queryStr = `
    SELECT DISTINCT ?subject WHERE {
      BIND(${sparqlEscapeUri(worshipAdministrativeUnit)} as ?worshipAdministrativeUnit)
      ?subject a ${sparqlEscapeUri(subjectType)}.

      ${pathToWorshipAdminUnit}

      GRAPH ${sparqlEscapeUri(DISPATCH_SOURCE_GRAPH)} {
        ?subject ?p ?o .
      }
      MINUS
      {
        GRAPH ?g {
          ?subject ?p ?o .
        }
        FILTER (?g != ${sparqlEscapeUri(DISPATCH_SOURCE_GRAPH)})
      }
    }
  `;

  const result = await query(queryStr);
  const subjects = result.results.bindings.map(r => r.subject.value);

  return [ ...new Set(subjects)];
}

export async function copySubjectDataToDestinationGraphs(subject, destinationGraphs) {
  let insertInGraphs = '';
  for (const destinationGraph of destinationGraphs) {
    insertInGraphs += `
      GRAPH ${sparqlEscapeUri(destinationGraph)} {
        ?s ?p ?o .
      }
    `;
  }

  // Insert in the destination graphs
  const insertQueryStr = `
    INSERT {
      ${insertInGraphs}
    }
    WHERE {
      BIND(${sparqlEscapeUri(subject)} as ?s)
      ?s ?p ?o .
    }
  `;
  await update(insertQueryStr);

  // Delete triples in graphs that are not in the destination graphs list
  destinationGraphs.push(DISPATCH_SOURCE_GRAPH);
  const graphsToKeep = `<${destinationGraphs.join('>, <')}>`;

  const deleteQueryStr = `
    DELETE {
      GRAPH ?g {
        ?s ?p ?o .
      }
    }
    WHERE {
      GRAPH ?g {
        BIND(${sparqlEscapeUri(subject)} as ?s)
        ?s ?p ?o .
      }
      FILTER (?g NOT IN ( ${graphsToKeep} ))
    }
  `;
  await update(deleteQueryStr);
}

export async function sendErrorAlert({message, detail, reference}) {
  if (!message)
    throw 'Error needs a message describing what went wrong.';
  const id = uuid();
  const uri = `http://data.lblod.info/errors/${id}`;
  const q = `
      PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
      PREFIX oslc: <http://open-services.net/ns/core#>
      PREFIX dct: <http://purl.org/dc/terms/>

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

export async function insertRepresentativeOrganExtraTriples(ro) {
  const queryStr = `
    PREFIX org: <http://www.w3.org/ns/org#>
    PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#>

    INSERT DATA {
      GRAPH ${sparqlEscapeUri(DISPATCH_SOURCE_GRAPH)} {
        ${sparqlEscapeUri(ro)} a besluit:Bestuurseenheid ;
          org:classification <http://data.vlaanderen.be/id/concept/BestuurseenheidClassificatieCode/36372fad-0358-499c-a4e3-f412d2eae213> .
      }
    }
  `;
  await update(queryStr);
}

export async function getSubjectsToDispatchAfterIngestOfSubject(ingestedSubject, path) {
  const queryStr = `
    SELECT DISTINCT ?subject WHERE {
      BIND(${sparqlEscapeUri(ingestedSubject)} as ?ingestedSubject)

      ${path}
    }
  `;

  const result = await query(queryStr);
  const subjects = result.results.bindings.map(r => r.subject.value);

  return [ ...new Set(subjects)];
}
