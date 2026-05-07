import { sparqlEscapeUri, sparqlEscapeString, sparqlEscapeDateTime, uuid } from "mu";
import { querySudo as query, updateSudo as update } from "@lblod/mu-auth-sudo";
import { parseResult } from './utils';
import {
  LANDING_ZONE_GRAPHS,
  DISPATCH_SOURCE_GRAPH,
  CREATOR,
  PUBLIC_GRAPH,
  INITIAL_DISPATCH_ENDPOINT,
  MANUAL_DISPATCH_BATCH_SIZE
} from '../config';
import {
  PREFIXES,
  STATUS_SUCCESS
} from '../constants';

export async function updateStatus(subject, status) {
  const modified = new Date();
  const q = `
    ${PREFIXES}
    DELETE {
      GRAPH ?g {
        ?subject adms:status ?status;
          dct:modified ?modified .
      }
    }
    INSERT {
      GRAPH ?g {
        ?subject adms:status ${sparqlEscapeUri(status)};
          dct:modified ${sparqlEscapeDateTime(modified)}.
      }
    }
    WHERE {
      BIND(${sparqlEscapeUri(subject)} as ?subject)
      GRAPH ?g {
        ?subject adms:status ?status .
        OPTIONAL { ?subject dct:modified ?modified . }
      }
    }
  `;
  await update(q);
}

export async function isSubjectPublicAfterAdditionalFilters(subject, publicDispatchConfig) {
  if (!publicDispatchConfig.additionalFilter) {
    return true;
  }

  const existsQuery = `
    ASK {
      BIND(${sparqlEscapeUri(subject)} as ?subject)

      ?subject a ${sparqlEscapeUri(publicDispatchConfig.type)}.
      ${publicDispatchConfig.additionalFilter}
    }
  `;

  return (await query(existsQuery, {},{ sparqlEndpoint: INITIAL_DISPATCH_ENDPOINT })).boolean;
}

export async function getTypesForSubject(subject) {
  const queryStr = `
    SELECT DISTINCT ?type {
      ${sparqlEscapeUri(subject)} a ?type.
    }
  `;

  return (await query(queryStr, {},{ sparqlEndpoint: INITIAL_DISPATCH_ENDPOINT })).results.bindings.map(r => r.type.value);
}

export async function getWorshipAdministrativeUnitForSubject(subject, config) {
  const queryStr = `
    SELECT DISTINCT ?worshipAdministrativeUnit WHERE {
      BIND(${sparqlEscapeUri(subject)} as ?subject)

      ?subject a ${sparqlEscapeUri(config.type)}.
      ${config.pathToWorshipAdminUnit}
    }
  `;

  const bindings = (await query(queryStr, {},{ sparqlEndpoint: INITIAL_DISPATCH_ENDPOINT })).results.bindings;

  if (bindings.length) {
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

  const result = await query(queryStr, {},{ sparqlEndpoint: INITIAL_DISPATCH_ENDPOINT });
  return parseResult(result).map(res => res.graph);
}

/**
 * Get the subjects which have some triples to move in org graphs.
 *
 * Same intent as before — only return subjects whose current placement is off,
 * so we don't pay the write cost for already-correct ones — but the work is
 * split into a handful of small, type-indexed queries instead of one big
 * UNION + nested MINUS over `?subject ?p ?o`. The set difference work
 * (the MINUS) is then done in JavaScript on small lists.
 *
 * Three categories of "needs a move":
 *   - misplaced: the subject sits in a graph that isn't source/landing/dest
 *   - missing-in-dest: the subject is in source but absent from at least one dest
 *   - orphan: the subject is in a dest graph but no longer in source
 */
export async function getRelatedSubjectsForWorshipAdministrativeUnit(
  worshipAdministrativeUnit,
  subjectType,
  pathToWorshipAdminUnit,
  destinationGraphs
) {
  const result = new Set();

  // 1. Candidates linked to the worship administrative unit via the
  //    configured path. Path resolution stays outside the GRAPH block (matches
  //    the original semantics), but presence in source is then confirmed with
  //    a type-indexed lookup in <source>.
  const inSourceList = await inSourceCandidatesForWorshipAdminUnit(
    worshipAdministrativeUnit,
    subjectType,
    pathToWorshipAdminUnit
  );
  const inSource = new Set(inSourceList);

  // 2. Missing-in-dest: among the candidates, which are absent from at least
  //    one destination graph? Done as a single presence query with VALUES on
  //    both subject and graph, then a count comparison in JS (the MINUS).
  if (inSource.size && destinationGraphs.length) {
    const presence = await subjectsOfTypePresenceInGraphs(
      [...inSource],
      destinationGraphs,
      subjectType
    );
    for (const subject of inSource) {
      const graphsHere = presence.get(subject);
      if (!graphsHere || graphsHere.size < destinationGraphs.length) {
        result.add(subject);
      }
    }
  }

  // 3. Misplaced: subjects of this type sitting in a graph that's neither
  //    source, landing zone, nor a current destination. We intersect with the
  //    in-source candidate set so we only act on subjects relevant to this
  //    worship administrative unit (the original required the path to resolve).
  const allowedGraphs = [
    DISPATCH_SOURCE_GRAPH,
    ...LANDING_ZONE_GRAPHS.split(','),
    ...destinationGraphs
  ];
  const misplaced = await subjectsOfTypeOutsideAllowedGraphs(subjectType, allowedGraphs);
  for (const subject of misplaced) {
    if (inSource.has(subject)) {
      result.add(subject);
    }
  }

  // 4. Orphans: subjects of this type in any of the worship administrative
  //    unit's destination graphs that no longer appear in source.
  if (destinationGraphs.length) {
    const orphans = await orphanSubjectsInGraphs(subjectType, destinationGraphs);
    for (const subject of orphans) {
      result.add(subject);
    }
  }

  return [...result];
}

async function inSourceCandidatesForWorshipAdminUnit(worshipAdministrativeUnit, subjectType, pathToWorshipAdminUnit) {
  const queryStr = `
    SELECT DISTINCT ?subject WHERE {
      BIND(${sparqlEscapeUri(worshipAdministrativeUnit)} as ?worshipAdministrativeUnit)

      ?subject a ${sparqlEscapeUri(subjectType)} .
      ${pathToWorshipAdminUnit}

      GRAPH ${sparqlEscapeUri(DISPATCH_SOURCE_GRAPH)} {
        ?subject a ${sparqlEscapeUri(subjectType)} .
      }
    }
  `;
  const result = await query(queryStr, {}, { sparqlEndpoint: INITIAL_DISPATCH_ENDPOINT });
  return [...new Set(result.results.bindings.map(r => r.subject.value))];
}

// Returns Map<subject, Set<graph>> indicating which of the given graphs each
// subject is present in (under the given type). Constrained to the candidate
// VALUES list so the optimizer can lean on the type index.
async function subjectsOfTypePresenceInGraphs(candidateSubjects, graphs, subjectType) {
  const presence = new Map();
  if (!candidateSubjects.length || !graphs.length) {
    return presence;
  }
  const subjectValues = candidateSubjects.map(s => sparqlEscapeUri(s)).join(' ');
  const graphValues = graphs.map(g => sparqlEscapeUri(g)).join(' ');
  const queryStr = `
    SELECT DISTINCT ?subject ?graph WHERE {
      VALUES ?subject { ${subjectValues} }
      VALUES ?graph { ${graphValues} }
      GRAPH ?graph {
        ?subject a ${sparqlEscapeUri(subjectType)} .
      }
    }
  `;
  const result = await query(queryStr, {}, { sparqlEndpoint: INITIAL_DISPATCH_ENDPOINT });
  for (const binding of result.results.bindings) {
    const subject = binding.subject.value;
    const graph = binding.graph.value;
    if (!presence.has(subject)) {
      presence.set(subject, new Set());
    }
    presence.get(subject).add(graph);
  }
  return presence;
}

async function subjectsOfTypeOutsideAllowedGraphs(subjectType, allowedGraphs) {
  const filterList = allowedGraphs.map(g => sparqlEscapeUri(g)).join(', ');
  const queryStr = `
    SELECT DISTINCT ?subject WHERE {
      GRAPH ?g {
        ?subject a ${sparqlEscapeUri(subjectType)} .
      }
      FILTER (?g NOT IN ( ${filterList} ))
    }
  `;
  const result = await query(queryStr, {}, { sparqlEndpoint: INITIAL_DISPATCH_ENDPOINT });
  return [...new Set(result.results.bindings.map(r => r.subject.value))];
}

async function orphanSubjectsInGraphs(subjectType, graphs) {
  const graphValues = graphs.map(g => sparqlEscapeUri(g)).join(' ');
  const queryStr = `
    SELECT DISTINCT ?subject WHERE {
      VALUES ?graph { ${graphValues} }
      GRAPH ?graph {
        ?subject a ${sparqlEscapeUri(subjectType)} .
      }
      FILTER NOT EXISTS {
        GRAPH ${sparqlEscapeUri(DISPATCH_SOURCE_GRAPH)} {
          ?subject a ${sparqlEscapeUri(subjectType)} .
        }
      }
    }
  `;
  const result = await query(queryStr, {}, { sparqlEndpoint: INITIAL_DISPATCH_ENDPOINT });
  return [...new Set(result.results.bindings.map(r => r.subject.value))];
}

export async function moveSubjectDataToDestinationGraphs(subject, destinationGraphs) {
  // Delete triples in all non-internal graphs (ingest graph and landing zones)
  const graphsToKeep = `<${[DISPATCH_SOURCE_GRAPH, ...LANDING_ZONE_GRAPHS.split(',')].join('>, <')}>`;

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

  // Insert in the destination graphs
  let insertInGraphs = '';
  for (const destinationGraph of destinationGraphs) {
    insertInGraphs += `
      GRAPH ${sparqlEscapeUri(destinationGraph)} {
        ?s ?p ?o .
      }
    `;
  }

  const insertQueryStr = `
    INSERT {
      ${insertInGraphs}
    }
    WHERE {
      GRAPH ${sparqlEscapeUri(DISPATCH_SOURCE_GRAPH)} {
        BIND(${sparqlEscapeUri(subject)} as ?s)
        ?s ?p ?o .
      }
    }
  `;
  await update(insertQueryStr);
}

export async function allInitialSyncsDone() {
  try {
    for (const operation of [
      'http://redpencil.data.gift/id/jobs/concept/JobOperation/deltas/consumer/wsSensitive',
      'http://redpencil.data.gift/id/jobs/concept/JobOperation/deltas/consumer/worshipPosts'
    ]) {

      const operationStatusQuery = `
        ${PREFIXES}
        SELECT DISTINCT ?s ?created WHERE {
          VALUES ?operation { ${sparqlEscapeUri(operation)} }
          VALUES ?status { ${sparqlEscapeUri(STATUS_SUCCESS)} }

          ?s a <http://vocab.deri.ie/cogs#Job> ;
            task:operation ?operation ;
            adms:status ?status ;
            dct:created ?created.
        }
        ORDER BY DESC(?created)
        LIMIT 1
      `;

      const result = await query(operationStatusQuery, {},{ sparqlEndpoint: INITIAL_DISPATCH_ENDPOINT });

      console.log(`Result for ${operation}: ${JSON.stringify(result)} `);

      const initial_sync_done = !!(result && result.results.bindings.length);
      if (!initial_sync_done) {
        console.log(`Initial sync for ${operation} not done yet.`);
        return false;
      } else {
        console.log(`Initial sync for ${operation} done.`);
      }
    }
    return true;
  } catch (e) {
    const error_message = `Error while checking if initial syncs are done: ${e.message ? e.message : e} `;
    console.log(error_message);
    sendErrorAlert({
      message: error_message
    });
    return false;
  }
}

export async function sendErrorAlert({ message, detail, reference }) {
  if (!message) {
    console.error('[WARN] sendErrorAlert called without a message — skipping.');
    return;
  }
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

    INSERT {
      GRAPH ${sparqlEscapeUri(DISPATCH_SOURCE_GRAPH)} {
        ${sparqlEscapeUri(ro)} a besluit:Bestuurseenheid ;
          org:classification <http://data.vlaanderen.be/id/concept/BestuurseenheidClassificatieCode/36372fad-0358-499c-a4e3-f412d2eae213> .
      }
    } WHERE {
      GRAPH ${sparqlEscapeUri(DISPATCH_SOURCE_GRAPH)} {
        ${sparqlEscapeUri(ro)} a <http://data.lblod.info/vocabularies/erediensten/RepresentatiefOrgaan> .
      }
    }
  `;
  await update(queryStr);
}

export async function insertKboForAcmidm(structuredIdentifier) {
  const queryStr = `
    PREFIX org: <http://www.w3.org/ns/org#>
    PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#>

    DELETE {
      GRAPH ?g {
        ?bestuur <http://purl.org/dc/terms/identifier> ?oldKbo .
      }
    }
    INSERT {
      GRAPH ?g {
        ?bestuur <http://purl.org/dc/terms/identifier> ?kbo .
      }
    } WHERE {
      GRAPH ?g {
        ?bestuur <http://www.w3.org/ns/adms#identifier> ?id .

        OPTIONAL {
          ?bestuur <http://purl.org/dc/terms/identifier> ?oldKbo .
        }
      }

      ?id <https://data.vlaanderen.be/ns/generiek#gestructureerdeIdentificator> ${sparqlEscapeUri(structuredIdentifier)} ;
        <http://www.w3.org/2004/02/skos/core#notation> "KBO nummer" .

      ${sparqlEscapeUri(structuredIdentifier)} <https://data.vlaanderen.be/ns/generiek#lokaleIdentificator> ?kbo .
    }
  `;
  await update(queryStr);
}

// Get all subjects in the dispatch source graph whose type matches one of the
// given types. Used by the manual dispatch endpoint to enumerate everything
// that should be re-evaluated.
//
// The query is split per type and paginated with LIMIT/OFFSET to avoid
// triggering large/expensive single queries on the triple store.
export async function getSubjectsInDispatchSourceGraphByTypes(types, batchSize = MANUAL_DISPATCH_BATCH_SIZE) {
  if (!types || !types.length) {
    return [];
  }
  const uniqueTypes = [...new Set(types)];
  const allSubjects = new Set();

  for (const type of uniqueTypes) {
    let offset = 0;
    let pageSize = 0;
    do {
      const queryStr = `
        SELECT DISTINCT ?subject WHERE {
          GRAPH ${sparqlEscapeUri(DISPATCH_SOURCE_GRAPH)} {
            ?subject a ${sparqlEscapeUri(type)} .
          }
        }
        ORDER BY ?subject
        LIMIT ${batchSize}
        OFFSET ${offset}
      `;
      const result = await query(queryStr, {}, { sparqlEndpoint: INITIAL_DISPATCH_ENDPOINT });
      const subjects = result.results.bindings.map(r => r.subject.value);
      pageSize = subjects.length;
      subjects.forEach(s => allSubjects.add(s));
      offset += batchSize;
    } while (pageSize === batchSize);
  }

  return [...allSubjects];
}

// Redispatch all subjects that are ingested but not in the public graph yet
export async function getSubjectsToRedispatchToPublicGraph(ingestedSubject, path) {
  const queryStr = `
    SELECT DISTINCT ?subject WHERE {
      BIND(${sparqlEscapeUri(ingestedSubject)} as ?ingestedSubject)

      ${path}

      GRAPH ${sparqlEscapeUri(DISPATCH_SOURCE_GRAPH)} {
        ?subject ?p ?o .
      }
      MINUS {
        GRAPH ${sparqlEscapeUri(PUBLIC_GRAPH)} {
          ?subject ?p ?o .
        }
      }
    }
  `;

  const result = await query(queryStr, {},{ sparqlEndpoint: INITIAL_DISPATCH_ENDPOINT });
  const subjects = result.results.bindings.map(r => r.subject.value);

  return [...new Set(subjects)];
}

// Redispatch all subjects that are linked to an ingested subject and that are not in the public graph yet
export async function getSubjectsToRedispatchToOrgGraph(ingestedSubject, path) {
  const queryStr = `
    PREFIX org: <http://www.w3.org/ns/org#>
    PREFIX mu: <http://mu.semte.ch/vocabularies/core/>

    SELECT DISTINCT ?subject WHERE {
      BIND(${sparqlEscapeUri(ingestedSubject)} as ?ingestedSubject)

      VALUES ?classification {
        <http://data.vlaanderen.be/id/concept/BestuurseenheidClassificatieCode/5ab0e9b8a3b2ca7c5e000000>
        <http://data.vlaanderen.be/id/concept/BestuurseenheidClassificatieCode/5ab0e9b8a3b2ca7c5e000001>
        <http://data.vlaanderen.be/id/concept/BestuurseenheidClassificatieCode/36372fad-0358-499c-a4e3-f412d2eae213>
      }
      ?ingestedSubject org:classification ?classification ;
        mu:uuid ?uuid .

      ${path}

      BIND(IRI(CONCAT("http://mu.semte.ch/graphs/organizations/", ?uuid, "/LoketLB-eredienstOrganisatiesGebruiker")) AS ?graph)

      GRAPH ${sparqlEscapeUri(DISPATCH_SOURCE_GRAPH)} {
        ?subject ?p ?o .
      }
      MINUS {
        GRAPH ?graph {
          ?subject ?p ?o .
        }
      }
    }
  `;

  const result = await query(queryStr, {},{ sparqlEndpoint: INITIAL_DISPATCH_ENDPOINT });
  const subjects = result.results.bindings.map(r => r.subject.value);

  return [...new Set(subjects)];
}

// Directly execute the query (bypassing mu-auth) when DIRECT_DATABASE_ENDPOINT is set
export async function moveSubjectsToPublicGraph(config) {
  const queryStr = `
    INSERT {
      GRAPH <http://mu.semte.ch/graphs/public> {
        ?subject ?p ?o .
      }
    } WHERE {
      GRAPH ${sparqlEscapeUri(DISPATCH_SOURCE_GRAPH)} {
        ?subject a ${sparqlEscapeUri(config.type)} ;
          ?p ?o .

        ${config.additionalFilter ? config.additionalFilter : ''}
      }
    }
  `;
  await update(
    queryStr,
    {
      // no extraheaders
    },
    {
      sparqlEndpoint: INITIAL_DISPATCH_ENDPOINT
    }
  );
}

// Directly execute the query (bypassing mu-auth) when DIRECT_DATABASE_ENDPOINT is set
export async function addKbosForAcmidm() {
  const queryStr = `
    PREFIX org: <http://www.w3.org/ns/org#>
    PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#>

    INSERT {
      GRAPH ?h {
        ?bestuur <http://purl.org/dc/terms/identifier> ?kbo .
      }
    } WHERE {
      GRAPH ?g {
        ?bestuur <http://www.w3.org/ns/adms#identifier> ?id .
      }

      ?id <https://data.vlaanderen.be/ns/generiek#gestructureerdeIdentificator>/<https://data.vlaanderen.be/ns/generiek#lokaleIdentificator> ?kbo ;
        <http://www.w3.org/2004/02/skos/core#notation> "KBO nummer" .

      ?bestuur <http://www.w3.org/ns/org#classification> ?bestuurClassification .

      FILTER (?bestuurClassification IN (
        <http://data.vlaanderen.be/id/concept/BestuurseenheidClassificatieCode/5ab0e9b8a3b2ca7c5e000001>,
        <http://data.vlaanderen.be/id/concept/BestuurseenheidClassificatieCode/5ab0e9b8a3b2ca7c5e000000>,
        <http://data.vlaanderen.be/id/concept/BestuurseenheidClassificatieCode/36372fad-0358-499c-a4e3-f412d2eae213>
      ))

      BIND (?g as ?h)
    }
  `;
  await update(
    queryStr,
    {
      // no extraheaders
    },
    {
      sparqlEndpoint: INITIAL_DISPATCH_ENDPOINT
    }
  );
}

// Directly execute the query (bypassing mu-auth) when DIRECT_DATABASE_ENDPOINT is set
export async function addExtraTriplesToRepresentativeOrgans() {
  const queryStr = `
    PREFIX org: <http://www.w3.org/ns/org#>
    PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#>

    INSERT {
      GRAPH ?h {
        ?ro a besluit:Bestuurseenheid ;
          org:classification <http://data.vlaanderen.be/id/concept/BestuurseenheidClassificatieCode/36372fad-0358-499c-a4e3-f412d2eae213> .
      }
    } WHERE {
      GRAPH ?g {
        ?ro a <http://data.lblod.info/vocabularies/erediensten/RepresentatiefOrgaan> .
      }
      BIND (?g as ?h)
    }
  `;
  await update(
    queryStr,
    {
      // no extraheaders
    },
    {
      sparqlEndpoint: INITIAL_DISPATCH_ENDPOINT
    }
  );
}

// Directly execute the query (bypassing mu-auth) when DIRECT_DATABASE_ENDPOINT is set
export async function moveSubjectsToOrgGraphs(config) {
  const queryStr = `
    PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
    PREFIX org: <http://www.w3.org/ns/org#>
    PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#>
    PREFIX ere: <http://data.lblod.info/vocabularies/erediensten/>

    INSERT {
      GRAPH ?graph {
        ?subject ?p ?o .
      }
    } WHERE {
      GRAPH ${sparqlEscapeUri(DISPATCH_SOURCE_GRAPH)} {
        ?subject a ${sparqlEscapeUri(config.type)} ;
          ?p ?o .

        ${config.pathToWorshipAdminUnit}
      }

      {
        ?ro org:linkedTo ?worshipAdministrativeUnit ;
          mu:uuid ?uuid .
      }
      UNION
      {
        VALUES ?classification {
          <http://data.vlaanderen.be/id/concept/BestuurseenheidClassificatieCode/5ab0e9b8a3b2ca7c5e000000>
          <http://data.vlaanderen.be/id/concept/BestuurseenheidClassificatieCode/5ab0e9b8a3b2ca7c5e000001>
        }

        ?betrokke org:organization ?worshipAdministrativeUnit .

        ?s a besluit:Bestuurseenheid ;
          mu:uuid ?uuid ;
          org:classification ?classification ;
          ere:betrokkenBestuur ?betrokke .
      }
      BIND(IRI(CONCAT("http://mu.semte.ch/graphs/organizations/", ?uuid, "/LoketLB-eredienstOrganisatiesGebruiker")) AS ?graph)    
    }
  `;
  await update(
    queryStr,
    {
      // no extraheaders
    },
    {
      sparqlEndpoint: INITIAL_DISPATCH_ENDPOINT
    }
  );
}
