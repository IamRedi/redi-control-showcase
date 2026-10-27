# REDI CONTROL

**Von der Quelle zum freigegebenen Inhalt.**

Eine mandantenfähige Steuerungsebene für Redaktion, Websites und Social Content. Eine Geschichte, unabhängige Kanalvarianten und nachvollziehbare menschliche Freigaben.

[![CI](https://github.com/IamRedi/redi-control-showcase/actions/workflows/ci.yml/badge.svg)](https://github.com/IamRedi/redi-control-showcase/actions/workflows/ci.yml)

**Next.js · React · TypeScript · Fastify · PostgreSQL · RLS · Transactional outbox**

![REDI CONTROL — actual application, fictional Aurora Media newsroom](docs/assets/hero.png)

[English](README.en.md) · [Engineering](docs/ENGINEERING.md) · [Evidence](EVIDENCE.md) · [Scope](docs/PUBLIC_SCOPE.md)

## Die Ingenieurarbeit

PostgreSQL RLS und rollenbasierte Autorisierung; versionierte Freigaben; Idempotenz und transaktionale Outbox; begrenzte Connector- und KI-Verträge.

- **Mandantengrenzen:** authentifizierter Akteur- und Mandantenkontext, Anwendungsregeln und PostgreSQL RLS; eingeschränkte Runtime-/Auth-Rollen.
- **Kontrollierte Inhalte:** Recherche, Belege und ein gemeinsames Content Item mit unabhängigen Website-, Facebook- und Instagram-Varianten.
- **Kontrollierte Ausführung:** versionsgebundene Freigaben, Payload-Hashes, Preflight, Idempotenz, Audit und Outbox.
- **Modulare Architektur:** getrennte Web-, API-, Worker- und Storage-Dienste mit gemeinsamer typisierter Domäne; Provider hinter klaren Schnittstellen.
- **KI-Grenzen:** mandantenbezogener Kontext, registrierte Werkzeuge, Schemas, Budgets, Herkunftsnachweise und menschliche Entscheidungen.
- **SaaS/White-Label:** Workzones, Rollen, Installationskonfiguration, Berechtigungen und begrenzte Kunden-APIs.

[Code-Rundgang](docs/ENGINEERING.md) · [Architecture](docs/ARCHITECTURE_SHOWCASE.md)

## Die Anwendung in 45 Sekunden

[![Actual application walkthrough](docs/assets/video/walkthrough-preview.webp)](docs/assets/video/walkthrough-de.mp4)

**[Video DE](docs/assets/video/walkthrough-de.mp4)** · **[Video EN](docs/assets/video/walkthrough-en.mp4)** · [Transcript](docs/assets/video/transcript.md)

Die Bilder stammen aus der tatsächlichen Anwendung mit einer fiktiven Redaktion. Aurora Media ist ein synthetischer Datensatz. Meta, BusinessSite und HeyGen sind nicht verbunden. Externe Nachrichtenabfragen, KI-Aufrufe und Veröffentlichungen sind im Showcase deaktiviert.

| Redaktion                                                 | Version / Freigabe                                          | Kalender                                                  |
| --------------------------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------- |
| ![Actual newsroom](docs/assets/screenshots/newsroom.webp) | ![Actual review queue](docs/assets/screenshots/review.webp) | ![Actual calendar](docs/assets/screenshots/calendar.webp) |

## Lokal prüfen

Node.js 22.22.1+ · npm · PostgreSQL 17 · Linux-/macOS-Shell oder WSL2

```bash
npm ci
npm run check
npm run test:integration
npm run showcase:offline-check
```

Integrationstests benötigen eine ausdrücklich konfigurierte Wegwerf-Datenbank; sie erstellen das Schema `control` neu. CI stellt einen eigenen PostgreSQL-17-Dienst bereit. Tests und Demo niemals gegen eine bestehende Installation ausführen.

```bash
npm run demo:start
# Öffnen: http://127.0.0.1:8788/auth/local-demo
# Das Einmal-Token bleibt in der ignorierten Datei tmp/local-demo-token.
npm run demo:stop
```

Die Docker-Demo verwendet ein eigenes Compose-Projekt, temporäre Daten und lokale Ports. Zugangsdaten eines echten Providers sind nicht erforderlich. [Demo reproduzieren](docs/DEMO.md).

## Nachweise und Grenzen

Lokal verifiziert: **159 Unit-Tests + 101 Integrationstests**, 44 SQL-Migrationen. Die 50 ursprünglichen Testdateien bleiben erhalten; zwei neue Regression-Suites prüfen das lokale Anmeldeformular und den serialisierten Social-Studio-Vertrag. Ergebnisse, Browser-Prüfungen und CI-Status stehen in [EVIDENCE.md](EVIDENCE.md).

Die sichtbare Anwendung nutzt reguläre Sitzungen, Mandantenkontext und gespeicherte synthetische Daten. Rollen und MFA-Status sind lokale Testdaten, kein Nachweis eines externen Identity-Providers. Provider bleiben getrennt. Historische Lesezugriffe belegen weder Veröffentlichung, Kommentare, Webhooks noch vollständige Analysen.

Original-Repository, Pilot, Produktionsdaten, Konten und Installation bleiben privat und getrennt. Diese Kopie mit neuer Git-Historie dient der Evaluierung.

## Autor und Lizenz

**Redion Cekrezi / RediON** · [GitHub](https://github.com/IamRedi)

Quellcode zur lokalen Evaluierung. Keine Open-Source-Lizenz; produktive/kommerzielle Nutzung und Weiterverbreitung erfordern eine Erlaubnis. [Lizenz](LICENSE) · [Abhängigkeiten und Quellen](THIRD_PARTY.md).
