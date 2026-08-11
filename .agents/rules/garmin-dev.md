# Garmin Tools — Vývojová pravidla

## Jazykové pravidlo
**Agent musí vždy komunikovat a psát dokumentaci v češtině.**
Veškeré komentáře v kódu, commit zprávy, README soubory a odpovědi uživateli musí být v českém jazyce.

## Strategie směrování modelů (Model Routing)

| Model | Použití |
|-------|---------|
| **Opus 4.6** | Hluboký strukturální refaktoring, komplexní binární matematika, architektonická rozhodnutí |
| **Sonnet 4.6** | Primární implementace features, hledání a oprava bugů, code review |
| **GPT-OSS 120B / Gemini Flash** | Rutinní HTML/CSS úpravy, docstringy, jednoduché unit testy |

## Architektura projektu

### Adresářová struktura
```
garmin-tools/
├── index.html              # Centrální hub / rozcestník
├── shared/                 # Sdílený kód pro všechny nástroje
│   ├── fit-core.js         # Univerzální FIT binární parser
│   └── design-tokens.css   # Společné CSS proměnné a utility
├── apps/
│   ├── activity-comparator/  # Porovnávání aktivit
│   ├── fit-repair-studio/    # Oprava FIT souborů
│   └── watch-finder/         # Hledání ztracených hodinek
├── FITs for tests/           # Testovací .fit soubory
└── .agents/rules/
    └── garmin-dev.md         # Tato pravidla
```

### Klíčové principy
1. **100% klientské zpracování** — žádné server-side uploady, vše běží v prohlížeči
2. **Nativní binární parsování** — používat `DataView`/`Uint8Array`, nikoliv těžké knihovny
3. **Sdílený kód patří do `shared/`** — aplikační kód do `apps/<název>/`
4. **Žádné `node_modules`** — pouze CDN závislosti (Leaflet, Chart.js, SheetJS, FontAwesome)
5. **Testovací soubory** — načítat z `FITs for tests/`

### FIT binární pravidla
- Garmin epoch offset: `631065600` (sekundy od 1970 do 1989-12-31)
- Převod semicircle → stupně: `value * (180.0 / 2147483648.0)`
- Invalid marker pozice: `0x7FFFFFFF` (sint32)
- CRC-16 kalkulace je **povinná** při exportu/zápisu .fit souborů
- Timestamp se ukládá jako **raw garmin uint32**, konverze na Date je na aplikační vrstvě

### CSS konvence
- Společné proměnné importovat ze `shared/design-tokens.css`
- Fonty: **Inter** (body), **Outfit** (nadpisy)
- Dark theme s glassmorphism efekty
- Každá aplikace má vlastní barevný akcent
