# worship-positions-graph-dispatcher-service

Microservice that listens to the delta notifier and dispatches positions (and related information) to the correct organisation graphs.
In this case, we dispatch the positions information in the same graphs where their related worship administrative unit is in.

Highly inspired by the `worship-submissions-graph-dispatcher-service`, adapted to this use case.

## Installation
Add the following snippet to your `docker-compose.yml`:

```yml
worship-positions-graph-dispatcher:
  image: lblod/worship-positions-graph-dispatcher-service
```

Configure the delta-notification service to send notifications on the `/delta` endpoint by adding the following rules in `./delta/rules.js`:

```javascript
export default [
  {
    match: {
      graph: {
        type: 'uri',
        value: 'http://mu.semte.ch/graphs/ingest'
      }
    },
    callback: {
      url: 'http://positions-dispatcher/delta',
      method: 'POST'
    },
    options: {
      resourceFormat: "v0.0.1",
      gracePeriod: 10000,
      ignoreFromSelf: true
    }
  }
]
```

## Initial dispatch

When starting the service, before dispatching the incoming deltas to the proper graphs, the service will check if an initial dispatching needs to happen. For this, it will check if the two related consumers (`worship-services-sensitive-consumer` and `worship-posts-consumer`) of the related application [app-worship-organizations](https://github.com/lblod/app-worship-organizations) have finished putting all ingested data into the ingest graph.

The service then proceeds to doing an initial dispatching. The goal is to reduce the time needed for the initial sync : bypassing mu-auth for this step makes the initial sync substantially faster.

## API

### POST /delta

Triggers the processing and dispatching of data following configuration in `disptch-config.js`

## Configuration

The dispatching can be customized in the `disptch-config.js` file. Below you can find a commented exemple of how the configuration works.

```
// Objects to dispatch to the organization graphs
export const dispatchToOrgGraphsConfig = [
  // An object per requirement
  {
    // The type to dispatch
    type: `http://data.lblod.info/vocabularies/erediensten/CentraalBestuurVanDeEredienst`,
    // In the case of org dispatching, we need the path from the current resource to the associted worship admin unit
    pathToWorshipAdminUnit: `?worshipAdministrativeUnit a <http://data.lblod.info/vocabularies/erediensten/CentraalBestuurVanDeEredienst> .\n FILTER(?worshipAdministrativeUnit = ?subject)`
  }
];

// Objects to dispatch to the public graph
export const dispatchToPublicGraphConfig = [
  // An object per requirement
  {
    // The type to dispatch
    type: `http://data.vlaanderen.be/ns/besluit#Bestuurseenheid`,
    // Optional filter that is applied to ensure the triples of this type should end up in the public graph
    additionalFilter: `
      ?subject <http://www.w3.org/ns/org#classification> ?bestuurClassification .
      FILTER (?bestuurClassification IN (
          <http://data.vlaanderen.be/id/concept/BestuurseenheidClassificatieCode/5ab0e9b8a3b2ca7c5e000001>,
          <http://data.vlaanderen.be/id/concept/BestuurseenheidClassificatieCode/5ab0e9b8a3b2ca7c5e000000>
        )
      )
    `,
    // Subjects for which we should trigger organization dispatching after ingested this subject
    // For example, municipalities are required to be able to dispatch worship admin units. So when a
    // municipality gets ingested, we need to trigger a dispatching for worship admin units related to it
    triggersRedispatchFor: [
      `?subject <https://data.vlaanderen.be/ns/generiek#isTijdspecialisatieVan>/<http://data.vlaanderen.be/ns/besluit#bestuurt> ?ingestedSubject .`,
      `?subject <http://data.vlaanderen.be/ns/besluit#bestuurt> ?ingestedSubject .`,
      `?ingestedSubject <http://www.w3.org/ns/org#classification> ?classification ;
        <http://data.lblod.info/vocabularies/erediensten/betrokkenBestuur>/<http://www.w3.org/ns/org#organization> ?subject .
      FILTER (?classification IN (
        <http://data.vlaanderen.be/id/concept/BestuurseenheidClassificatieCode/5ab0e9b8a3b2ca7c5e000000>,
        <http://data.vlaanderen.be/id/concept/BestuurseenheidClassificatieCode/5ab0e9b8a3b2ca7c5e000001>
      ))`,
    ]
  }
];
```
