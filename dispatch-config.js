/*
 * This file is used as helper for fetching subjects related to a worship administrative unit
 * (ere:BestuurVanDeEredienst or ere:CentraalBestuurVanDeEredienst).
 * It provides some path template queries as a shorthand to fetch the related subject.
 * See code to check how it is used.
 */
export const dispatchToOrgGraphsConfig = [
  {
    type: `http://data.lblod.info/vocabularies/erediensten/CentraalBestuurVanDeEredienst`,
    pathToWorshipAdminUnit: `?worshipAdministrativeUnit a <http://data.lblod.info/vocabularies/erediensten/CentraalBestuurVanDeEredienst> .\n FILTER(?worshipAdministrativeUnit = ?subject)`
  },
  {
    type: `http://data.lblod.info/vocabularies/erediensten/BestuurVanDeEredienst`,
    pathToWorshipAdminUnit: `?worshipAdministrativeUnit a <http://data.lblod.info/vocabularies/erediensten/BestuurVanDeEredienst> .\n FILTER(?worshipAdministrativeUnit = ?subject)`
  },
  {
    type: `http://data.vlaanderen.be/ns/besluit#Bestuursorgaan`,
    pathToWorshipAdminUnit: `
      ?subject (<https://data.vlaanderen.be/ns/generiek#isTijdspecialisatieVan>/<http://data.vlaanderen.be/ns/besluit#bestuurt>)|(<http://data.vlaanderen.be/ns/besluit#bestuurt>) ?worshipAdministrativeUnit . ?worshipAdministrativeUnit <http://www.w3.org/ns/org#classification> ?bestuurClassification .
      FILTER (?bestuurClassification IN (
        <http://data.vlaanderen.be/id/concept/BestuurseenheidClassificatieCode/f9cac08a-13c1-49da-9bcb-f650b0604054>,
        <http://data.vlaanderen.be/id/concept/BestuurseenheidClassificatieCode/66ec74fd-8cfc-4e16-99c6-350b35012e86>
      ))
    `
  },
  {
    type: `http://data.vlaanderen.be/ns/mandaat#Mandaat`,
    pathToWorshipAdminUnit: `
      ?orgaanInTime <http://www.w3.org/ns/org#hasPost> ?subject ;
        <https://data.vlaanderen.be/ns/generiek#isTijdspecialisatieVan> ?orgaan .
      ?orgaan <http://data.vlaanderen.be/ns/besluit#bestuurt> ?worshipAdministrativeUnit .
    `
  },
  {
    type: `http://data.vlaanderen.be/ns/mandaat#Mandaat`,
    pathToWorshipAdminUnit: `
      ?orgaanInTime <http://www.w3.org/ns/org#hasPost> ?subject ;
        <https://data.vlaanderen.be/ns/generiek#isTijdspecialisatieVan> ?orgaan .
      ?orgaan <http://data.vlaanderen.be/ns/besluit#bestuurt> ?worshipAdministrativeUnit .
    `
  },
  {
    type: `http://data.lblod.info/vocabularies/erediensten/PositieBedienaar`,
    pathToWorshipAdminUnit: `
      ?worshipAdministrativeUnit <http://data.lblod.info/vocabularies/erediensten/wordtBediendDoor> ?subject .
    `
  },
  {
    type: `http://data.lblod.info/vocabularies/erediensten/EredienstMandataris`,
    pathToWorshipAdminUnit: `
      ?subject <http://www.w3.org/ns/org#holds> ?mandate .
      ?orgaanInTime <http://www.w3.org/ns/org#hasPost> ?mandate ;
        <https://data.vlaanderen.be/ns/generiek#isTijdspecialisatieVan> ?orgaan .
      ?orgaan <http://data.vlaanderen.be/ns/besluit#bestuurt> ?worshipAdministrativeUnit .
    `
  },
  {
    type: `http://data.lblod.info/vocabularies/erediensten/RolBedienaar`,
    pathToWorshipAdminUnit: `
      ?subject <http://www.w3.org/ns/org#holds> ?position .
      ?worshipAdministrativeUnit <http://data.lblod.info/vocabularies/erediensten/wordtBediendDoor> ?position .
    `
  },
  {
    type: `http://www.w3.org/ns/person#Person`, // Person linked to a EredienstMandataris
    pathToWorshipAdminUnit: `
      ?mandataris <http://data.vlaanderen.be/ns/mandaat#isBestuurlijkeAliasVan> ?subject ;
        <http://www.w3.org/ns/org#holds> ?mandate .
      ?orgaanInTime <http://www.w3.org/ns/org#hasPost> ?mandate ;
        <https://data.vlaanderen.be/ns/generiek#isTijdspecialisatieVan> ?orgaan .
      ?orgaan <http://data.vlaanderen.be/ns/besluit#bestuurt> ?worshipAdministrativeUnit .
    `
  },
  {
    type: `http://www.w3.org/ns/person#Person`, // Person linked to a RolBedienaar
    pathToWorshipAdminUnit: `
      ?minister <http://www.w3.org/ns/org#heldBy> ?subject ;
        <http://www.w3.org/ns/org#holds> ?position .
      ?worshipAdministrativeUnit <http://data.lblod.info/vocabularies/erediensten/wordtBediendDoor> ?position .
    `
  },
  {
    type: `https://data.vlaanderen.be/ns/persoon#Geboorte`, // Birthdate of person linked to a EredienstMandataris
    pathToWorshipAdminUnit: `
      ?person <https://data.vlaanderen.be/ns/persoon#heeftGeboorte> ?subject .
      ?mandataris <http://data.vlaanderen.be/ns/mandaat#isBestuurlijkeAliasVan> ?person ;
        <http://www.w3.org/ns/org#holds> ?mandate .
      ?orgaanInTime <http://www.w3.org/ns/org#hasPost> ?mandate ;
        <https://data.vlaanderen.be/ns/generiek#isTijdspecialisatieVan> ?orgaan .
      ?orgaan <http://data.vlaanderen.be/ns/besluit#bestuurt> ?worshipAdministrativeUnit .
    `
  },
  {
    type: `https://data.vlaanderen.be/ns/persoon#Geboorte`, // Birthdate of person linked to a RolBedienaar
    pathToWorshipAdminUnit: `
      ?person <https://data.vlaanderen.be/ns/persoon#heeftGeboorte> ?subject .
      ?minister <http://www.w3.org/ns/org#heldBy> ?person ;
        <http://www.w3.org/ns/org#holds> ?position .
      ?worshipAdministrativeUnit <http://data.lblod.info/vocabularies/erediensten/wordtBediendDoor> ?position .
    `
  },
  {
    type: `http://www.w3.org/ns/adms#Identifier`, // Id of person linked to a EredienstMandataris
    pathToWorshipAdminUnit: `
      ?person <https://data.vlaanderen.be/ns/persoon#registratie> ?subject .
      ?mandataris <http://data.vlaanderen.be/ns/mandaat#isBestuurlijkeAliasVan> ?person ;
        <http://www.w3.org/ns/org#holds> ?mandate .
      ?orgaanInTime <http://www.w3.org/ns/org#hasPost> ?mandate ;
        <https://data.vlaanderen.be/ns/generiek#isTijdspecialisatieVan> ?orgaan .
      ?orgaan <http://data.vlaanderen.be/ns/besluit#bestuurt> ?worshipAdministrativeUnit .
    `
  },
  {
    type: `http://www.w3.org/ns/adms#Identifier`, // Id of person linked to a RolBedienaar
    pathToWorshipAdminUnit: `
      ?person <https://data.vlaanderen.be/ns/persoon#registratie> ?subject .
      ?minister <http://www.w3.org/ns/org#heldBy> ?person ;
        <http://www.w3.org/ns/org#holds> ?position .
      ?worshipAdministrativeUnit <http://data.lblod.info/vocabularies/erediensten/wordtBediendDoor> ?position .
    `
  },
  {
    type: `https://data.vlaanderen.be/ns/generiek#GestructureerdeIdentificator`, // Structured id of person linked to a EredienstMandataris
    pathToWorshipAdminUnit: `
      ?id <https://data.vlaanderen.be/ns/generiek#gestructureerdeIdentificator> ?subject .
      ?person <https://data.vlaanderen.be/ns/persoon#registratie> ?id .
      ?mandataris <http://data.vlaanderen.be/ns/mandaat#isBestuurlijkeAliasVan> ?person ;
        <http://www.w3.org/ns/org#holds> ?mandate .
      ?orgaanInTime <http://www.w3.org/ns/org#hasPost> ?mandate ;
        <https://data.vlaanderen.be/ns/generiek#isTijdspecialisatieVan> ?orgaan .
      ?orgaan <http://data.vlaanderen.be/ns/besluit#bestuurt> ?worshipAdministrativeUnit .
    `
  },
  {
    type: `https://data.vlaanderen.be/ns/generiek#GestructureerdeIdentificator`, // Structured id of person linked to a RolBedienaar
    pathToWorshipAdminUnit: `
      ?id <https://data.vlaanderen.be/ns/generiek#gestructureerdeIdentificator> ?subject .
      ?person <https://data.vlaanderen.be/ns/persoon#registratie> ?id .
      ?minister <http://www.w3.org/ns/org#heldBy> ?person ;
        <http://www.w3.org/ns/org#holds> ?position .
      ?worshipAdministrativeUnit <http://data.lblod.info/vocabularies/erediensten/wordtBediendDoor> ?position .
    `
  },
  {
    type: `http://schema.org/ContactPoint`, // Contact point linked to a EredienstMandataris
    pathToWorshipAdminUnit: `
      ?mandataris <http://schema.org/contactPoint> ?subject ;
        <http://www.w3.org/ns/org#holds> ?mandate .
      ?orgaanInTime <http://www.w3.org/ns/org#hasPost> ?mandate ;
        <https://data.vlaanderen.be/ns/generiek#isTijdspecialisatieVan> ?orgaan .
      ?orgaan <http://data.vlaanderen.be/ns/besluit#bestuurt> ?worshipAdministrativeUnit .
    `
  },
  {
    type: `http://schema.org/ContactPoint`, // Contact point linked to a RolBedienaar
    pathToWorshipAdminUnit: `
      ?minister <http://schema.org/contactPoint> ?subject ;
        <http://www.w3.org/ns/org#holds> ?position .
      ?worshipAdministrativeUnit <http://data.lblod.info/vocabularies/erediensten/wordtBediendDoor> ?position .
    `
  },
  {
    type: `http://www.w3.org/ns/locn#Address`, // Address linked to a EredienstMandataris
    pathToWorshipAdminUnit: `
      ?address <http://www.w3.org/ns/locn#address> ?subject .
      ?mandataris <http://schema.org/contactPoint> ?address ;
        <http://www.w3.org/ns/org#holds> ?mandate .
      ?orgaanInTime <http://www.w3.org/ns/org#hasPost> ?mandate ;
        <https://data.vlaanderen.be/ns/generiek#isTijdspecialisatieVan> ?orgaan .
      ?orgaan <http://data.vlaanderen.be/ns/besluit#bestuurt> ?worshipAdministrativeUnit .
    `
  },
  {
    type: `http://www.w3.org/ns/locn#Address`, // Address linked to a RolBedienaar
    pathToWorshipAdminUnit: `
    ?address <http://www.w3.org/ns/locn#address> ?subject .
      ?minister <http://schema.org/contactPoint> ?address ;
        <http://www.w3.org/ns/org#holds> ?position .
      ?worshipAdministrativeUnit <http://data.lblod.info/vocabularies/erediensten/wordtBediendDoor> ?position .
    `
  },
  {
    type: `http://www.w3.org/ns/org#Site`, // Site of a worship service
    pathToWorshipAdminUnit: `
      ?worshipAdministrativeUnit <http://www.w3.org/ns/org#hasPrimarySite>|<http://www.w3.org/ns/org#hasSite> ?subject .
    `
  },
  {
    type: `http://www.w3.org/ns/locn#Address`, // Address of a site of a worship service
    pathToWorshipAdminUnit: `
      ?site <https://data.vlaanderen.be/ns/organisatie#bestaatUit> ?subject .
      ?worshipAdministrativeUnit <http://www.w3.org/ns/org#hasPrimarySite>|<http://www.w3.org/ns/org#hasSite> ?site .
    `
  },
];

export const dispatchToPublicGraphConfig = [
  {
    type: `http://data.vlaanderen.be/ns/besluit#Bestuurseenheid`,
    additionalFilter: `
      ?subject a <http://data.vlaanderen.be/ns/besluit#Bestuurseenheid> ;
        <http://www.w3.org/ns/org#classification> ?bestuurClassification .
      FILTER (?bestuurClassification IN (
          <http://data.vlaanderen.be/id/concept/BestuurseenheidClassificatieCode/5ab0e9b8a3b2ca7c5e000001>,
          <http://data.vlaanderen.be/id/concept/BestuurseenheidClassificatieCode/5ab0e9b8a3b2ca7c5e000000>
        )
      )
    `,
    triggersPublicDispatchFor: [
      `?subject <https://data.vlaanderen.be/ns/generiek#isTijdspecialisatieVan>/<http://data.vlaanderen.be/ns/besluit#bestuurt> ?ingestedSubject .`,
      `?subject <http://data.vlaanderen.be/ns/besluit#bestuurt> ?ingestedSubject .`,
    ],
    triggersOrgDispatchFor: [
      `?ingestedSubject <http://www.w3.org/ns/org#classification> ?classification ;
        <http://data.lblod.info/vocabularies/erediensten/betrokkenBestuur>/<http://www.w3.org/ns/org#organization> ?subject .

      FILTER (?classification IN (
        <http://data.vlaanderen.be/id/concept/BestuurseenheidClassificatieCode/5ab0e9b8a3b2ca7c5e000000>,
        <http://data.vlaanderen.be/id/concept/BestuurseenheidClassificatieCode/5ab0e9b8a3b2ca7c5e000001>
      ))`,
    ]
  },
  {
    type: `http://data.vlaanderen.be/ns/besluit#Bestuursorgaan`,
    additionalFilter: `
      ?subject (<https://data.vlaanderen.be/ns/generiek#isTijdspecialisatieVan>/<http://data.vlaanderen.be/ns/besluit#bestuurt>)|(<http://data.vlaanderen.be/ns/besluit#bestuurt>) ?administrativeUnit . ?administrativeUnit <http://www.w3.org/ns/org#classification> ?bestuurClassification .
      FILTER (?bestuurClassification IN (
        <http://data.vlaanderen.be/id/concept/BestuurseenheidClassificatieCode/5ab0e9b8a3b2ca7c5e000001>,
        <http://data.vlaanderen.be/id/concept/BestuurseenheidClassificatieCode/5ab0e9b8a3b2ca7c5e000000>
      ))
    `
  },
  {
    type: `http://data.lblod.info/vocabularies/erediensten/RepresentatiefOrgaan`,
    triggersOrgDispatchFor: [
      `?ingestedSubject <http://www.w3.org/ns/org#linkedTo> ?subject .`,
    ]
  },
  {
    type: `http://data.lblod.info/vocabularies/erediensten/BetrokkenLokaleBesturen`,
    triggersOrgDispatchFor: [
      `?ingestedSubject <http://www.w3.org/ns/org#organization> ?subject .`,
    ]
  },
  {
    type: `http://lblod.data.gift/vocabularies/organisatie/BestuurseenheidClassificatieCode`,
    triggersPublicDispatchFor: [
      `?subject <https://data.vlaanderen.be/ns/generiek#isTijdspecialisatieVan>/<http://data.vlaanderen.be/ns/besluit#bestuurt>/<http://www.w3.org/ns/org#classification> ?ingestedSubject .`,
      `?subject <http://data.vlaanderen.be/ns/besluit#bestuurt>/<http://www.w3.org/ns/org#classification> ?ingestedSubject .`,
      `?subject <http://www.w3.org/ns/org#classification> ?ingestedSubject .`,
    ],
    triggersOrgDispatchFor: [
      `?bestuur <http://www.w3.org/ns/org#classification> ?ingestedSubject ;
        <http://data.lblod.info/vocabularies/erediensten/betrokkenBestuur>/<http://www.w3.org/ns/org#organization> ?subject .

        FILTER (?ingestedSubject IN (
          <http://data.vlaanderen.be/id/concept/BestuurseenheidClassificatieCode/5ab0e9b8a3b2ca7c5e000000>,
          <http://data.vlaanderen.be/id/concept/BestuurseenheidClassificatieCode/5ab0e9b8a3b2ca7c5e000001>
        ))`,
    ]
  },
  {
    type: `http://lblod.data.gift/vocabularies/organisatie/BestuursorgaanClassificatieCode`
  },
  {
    type: `http://lblod.data.gift/vocabularies/organisatie/TypeVestiging`
  },
  {
    type: `http://lblod.data.gift/vocabularies/organisatie/OrganisatieStatusCode`
  },
  {
    type: `http://lblod.data.gift/vocabularies/organisatie/TypeBetrokkenheid`
  },
  {
    type: `http://lblod.data.gift/vocabularies/organisatie/TypeEredienst`
  },
  {
    type: `http://lblod.data.gift/vocabularies/organisatie/BestuursfunctieCode`
  },
  {
    type: `http://lblod.data.gift/vocabularies/organisatie/EredienstBeroepen`
  },
  {
    type: `http://mu.semte.ch/vocabularies/ext/GeslachtCode`
  },
  {
    type: `http://publications.europa.eu/ontology/euvoc#Country`
  }
];
