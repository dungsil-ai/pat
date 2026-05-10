# AGENTS.md

This file provides guidance to AI when working with code in this repository.

## Project Overview

This is a **Paradox Interactive Game Mod Translation Tool** that automatically translates localization files for **Crusader Kings III (CK3)** mods from English to Korean using Google's Gemini AI. The tool processes game mod files while preserving game-specific formatting, variables, and syntax.

## Common Commands

```bash
# Update all upstream repositories (optimized sparse checkout)
pnpm upstream

# Run CK3 translation process
pnpm ck3

# Update file hashes without translating (useful for detecting changes)
pnpm ck3:update-hash

# Invalidate translations based on dictionary updates
pnpm ck3:update-dict

# Retranslate incorrectly translated items (based on validation rules)
pnpm ck3:retranslate

# Run VIC3 translation process
pnpm vic3

# Update VIC3 file hashes without translating
pnpm vic3:update-hash

# Invalidate VIC3 translations based on dictionary updates
pnpm vic3:update-dict

# Retranslate incorrectly translated VIC3 items
pnpm vic3:retranslate

# Run Stellaris translation process
pnpm stellaris

# Update Stellaris file hashes without translating
pnpm stellaris:update-hash

# Invalidate Stellaris translations based on dictionary updates
pnpm stellaris:update-dict

# Retranslate incorrectly translated Stellaris items
pnpm stellaris:retranslate

# Install dependencies
pnpm install
```

## Architecture

### Metadata-Driven Processing
Each mod directory contains a `meta.toml` file that defines translation configuration:
```toml
[upstream]
localization = ["RICE/localization/english"]  # Source file paths
language = "english"                          # Source language
```

### Translation Pipeline
1. **Upstream Update**: Optimized repository sync using sparse checkout (`utils/upstream.ts`)
2. **Discovery**: Scan for `meta.toml` files in game directories
3. **Parsing**: Parse YAML localization files (`l_english:` → `l_korean:`)
4. **Hashing**: Generate content hashes to detect changes (via `utils/hashing.ts`)
5. **Translation**: AI translation with CK3-specific context prompts
6. **Caching**: Store translations in database to avoid redundant API calls
7. **Output**: Generate Korean files with `___` prefix for proper load order

### Key Components

**Core Translation Logic** (`scripts/factory/translate.ts`):
- Orchestrates the entire translation workflow
- Handles file discovery, parsing, and output generation

**AI Integration** (`scripts/utils/ai.ts`):
- Google Gemini API integration
- Context-aware prompts for medieval/historical content
- Retry logic for API failures

**Game-Specific Parsing** (`scripts/parser/yaml.ts`):
- Preserves CK3 variables (`$k_france$`, `[GetTitle]`, `#bold#`)
- Converts file naming: `*_l_english.yml` → `___*_l_korean.yml`

**Smart Caching System** (`scripts/utils/cache.ts`):
- Content-based hashing to detect source changes
- Translation memory with manual dictionary overrides
- Persistent storage to avoid retranslation

**Translation Validation** (`scripts/utils/translation-validator.ts`):
- Detects incorrectly translated items based on validation rules
- Validates preservation of technical identifiers (snake_case like `mod_icon_*`)
- Ensures game variables in brackets remain untranslated (e.g., `[region|E]`, `[GetTitle]`)
- Checks for unwanted LLM responses in translations
- Used by retranslation script to find items that need re-translation

### Directory Structure

```
ck3/                    # CK3 mods to translate
├── RICE/              # "Rajas of Asia in CK3 Events" mod
├── VIET/              # "VIET Events" mod
└── [MOD_NAME]/        # Pattern for additional mods
    ├── meta.toml      # Configuration
    ├── upstream/      # Original English files
    └── mod/           # Generated Korean translations

scripts/
├── ck3.ts            # Main entry point
├── factory/          # Translation processing
├── parser/           # File parsing (TOML, YAML)
└── utils/            # AI, caching, logging utilities
```

## Development Notes

- Uses TypeScript with jiti for direct execution
- Google Gemini AI integration uses `GOOGLE_AI_STUDIO_TOKEN` by default and falls back to `GOOGLE_GENERATIVE_AI_API_KEY`
- The repository pins Node.js via `.node-version` (currently v24.11.1), and GitHub composite actions also run on Node 24
- File hashing system prevents unnecessary retranslation of unchanged content
- Translation dictionary in `scripts/utils/dictionary.ts` provides manual overrides
- Logging system supports different verbosity levels via `scripts/utils/logger.ts`

### Working with Upstream Source Files

**Important**: The `upstream/` directories are **NOT committed to the repository**. They contain the original English localization files from the game mods and are automatically downloaded during the translation process.

#### Upstream Update Process

All translation scripts (`pnpm ck3`, `pnpm vic3`, `pnpm stellaris`) **automatically update upstream repositories** at the beginning of their execution. This ensures you always work with the latest source files.

**Manual upstream update**:
```bash
# Update all upstream repositories for all games
pnpm upstream
```

The upstream update process:
1. Uses **sparse checkout** to download only the localization files (efficient, no full repository clone)
2. Configured in `meta.toml` files in each mod directory
3. Pulls latest changes from the game mod repositories
4. Only downloads files specified in `meta.toml` → `upstream.localization` paths

**If you need to test validation**:
```bash
# Step 1: Ensure upstream files are present
pnpm upstream

# Step 2: Run retranslate to validate existing translations
pnpm ck3:retranslate
```

**Directory structure after upstream update**:
```
ck3/RICE/
├── meta.toml
├── upstream/              # Downloaded automatically (NOT in git)
│   └── RICE/localization/english/
│       └── *.yml         # Source English files
└── mod/                  # Generated translations (committed)
    └── localization/korean/
        └── ___*.yml      # Korean translation files
```
