# External news source policy

External publishers are supplemental context. Our stories are generated from our own structured data.

- Store only: headline, canonical link, publisher, timestamp, a short excerpt where terms allow, tags /
  entities. Never scrape or republish full copyrighted articles.
- A wire story is not our article. Facts taken from a report are attributed to that report by name.
- Cross-publisher duplicates cluster into one real-world event; the official/primary source wins as
  canonical where one exists.
- Every source goes in `data/news-sources.json` with its terms status before it is ingested. The list is
  empty until each feed is verified with a real request (no source is listed from memory).
- Medical, personal-life or motivation claims require an attributable primary report and are labeled
  as reported, never as fact.
