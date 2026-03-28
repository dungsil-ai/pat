# AGENTS.md

This file provides guidance to AI when working with code in this repository.

## Project Overview

This is a **Paradox Interactive Game Mod Translation Tool** that automatically translates localization files for **Crusader Kings III (CK3)**, **Victoria 3 (VIC3)**, and **Stellaris** mods from English to Korean using Google Gemini via **ai-sdk.dev**. The tool processes game mod files while preserving game-specific formatting, variables, and syntax.

## Common Commands

```bash
# Update all upstream repositories (optimized sparse checkout)
pnpm upstream

# Update upstream repositories for a specific game
pnpm upstream ck3          # CK3 only
pnpm upstream vic3         # VIC3 only
pnpm upstream stellaris    # Stellaris only

# Update upstream for a specific mod in a specific game
pnpm upstream ck3 RICE     # CK3's RICE mod only
pnpm upstream vic3 "Better Politics Mod"  # VIC3's Better Politics Mod

# Get help for upstream command
pnpm upstream --help

# Run CK3 translation process
pnpm ck3

# Update file hashes without translating (useful for detecting changes)
pnpm ck3:update-hash

# Invalidate translations based on dictionary updates
pnpm ck3:update-dict

# Invalidate translations based on dictionary updates (with filtering options)
# Only invalidate translations for dictionary keys changed in a specific commit
pnpm ck3:update-dict -- --since-commit <commit-id>

# Only invalidate translations for dictionary keys changed in a commit range
pnpm ck3:update-dict -- --commit-range <from-commit>..<to-commit>

# Only invalidate translations for dictionary keys changed since a specific date
pnpm ck3:update-dict -- --since-date "2024-01-01"

# Retranslate incorrectly translated items (based on validation rules)
# For transliteration files (culture, dynasty, names), also detects semantic translations
pnpm ck3:retranslate

# Run VIC3 translation process
pnpm vic3

# Update VIC3 file hashes without translating
pnpm vic3:update-hash

# Invalidate VIC3 translations based on dictionary updates
pnpm vic3:update-dict

# With filtering options (same as CK3)
pnpm vic3:update-dict -- --since-commit <commit-id>
pnpm vic3:update-dict -- --commit-range <from>..<to>
pnpm vic3:update-dict -- --since-date "2024-01-01"

# Retranslate incorrectly translated VIC3 items
# For transliteration files (culture, dynasty, names), also detects semantic translations
pnpm vic3:retranslate

# Run Stellaris translation process
pnpm stellaris

# Update Stellaris file hashes without translating
pnpm stellaris:update-hash

# Invalidate Stellaris translations based on dictionary updates
pnpm stellaris:update-dict

# With filtering options (same as CK3)
pnpm stellaris:update-dict -- --since-commit <commit-id>
pnpm stellaris:update-dict -- --commit-range <from>..<to>
pnpm stellaris:update-dict -- --since-date "2024-01-01"

# Retranslate incorrectly translated Stellaris items
# For transliteration files (culture, dynasty, names), also detects semantic translations
pnpm stellaris:retranslate

# Invalidate translations when transliteration_files list changes in meta.toml
# This marks affected files for retranslation with the correct mode
pnpm invalidate-transliteration-files -- --since-commit <commit-id>

# Add dictionary entries from a git commit
pnpm add-dict <commit-id>

# Sort all dictionary files alphabetically (within comment groups)
pnpm sort-dict

# Sort dictionaries in dry-run mode (preview changes without modifying files)
pnpm sort-dict -- --dry-run

# Run tests (run before and after script modifications)
pnpm test

# Run tests in watch mode
pnpm test:watch

# Run tests with coverage
pnpm test:coverage

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

# Optional: Manually specify files to use transliteration mode
# Supports exact filenames and wildcard patterns (*)
transliteration_files = ["custom_events_l_english.yml", "*_special_names_*"]
```

The `transliteration_files` option allows manual specification of files that should use transliteration mode (음역) instead of semantic translation. This is useful for files that don't match the automatic detection patterns but contain proper nouns that should be transliterated.

### Translation Pipeline
1. **Upstream Update**: Optimized repository sync using sparse checkout (`utils/upstream.ts`)
2. **Discovery**: Scan for `meta.toml` files in game directories
3. **Parsing**: Parse YAML localization files (`l_english:` → `l_korean:`)
4. **Mode Detection**: Automatic or manual transliteration mode detection
   - Automatic: Based on filename patterns (culture, dynasty, names keywords)
   - Manual: Via `transliteration_files` option in `meta.toml`
5. **Hashing**: Generate content hashes to detect changes (via `utils/hashing.ts`)
6. **Upstream hash skip**: Skip translation when the upstream file hash is unchanged from the previous run
7. **Translation/Transliteration**: AI translation or transliteration with game-specific context prompts
8. **Caching**: Store results in database with separate cache keys for translation vs transliteration
9. **Output**: Generate Korean files with `___` prefix for proper load order

### Key Components

**Core Translation Logic** (`scripts/factory/translate.ts`):
- Orchestrates the entire translation workflow
- Automatic transliteration mode detection via `shouldUseTransliteration(filename)`
- Manual transliteration file specification via `meta.toml`'s `transliteration_files` option
- Handles file discovery, parsing, and output generation
- Translation refusal tracking and graceful error handling
- Exports untranslated items to `{game}-untranslated-items.json`
- Defaults parallel workers to the detected mod count; ETC `upstream/` subfolders are treated as separate mods for concurrency

**AI Integration** (`scripts/utils/ai.ts`):
- Google Gemini via **ai-sdk.dev** (primary) using `GOOGLE_AI_STUDIO_TOKEN`
- Optional fallback to legacy Gemini key (`GOOGLE_GENERATIVE_AI_API_KEY`)
- Configurable model via `GEMINI_MODEL` (default `gemini-flash-lite-latest`)
- Context-aware prompts for medieval/historical content
- Separate transliteration prompts for proper nouns (culture, dynasty, character names)
- Retry logic for API failures
- Translation refusal detection and error handling

**Prompt Management** (`scripts/utils/prompts.ts` and `prompts/` directory):
- **External prompt files**: All AI prompts are stored as Markdown files in the `prompts/` directory
  - `prompts/ck3-translation.md` - CK3 translation prompt
  - `prompts/ck3-transliteration.md` - CK3 transliteration prompt
  - Similar files for Stellaris and VIC3
- **Dynamic loading**: Prompts are loaded from files at runtime and support template substitution
  - `{{TRANSLATION_MEMORY}}` - Replaced with glossary dictionary
  - `{{PROPER_NOUNS_DICTIONARY}}` - Replaced with proper nouns dictionary
- Dual-mode system: translation prompts vs transliteration prompts
- `getSystemPrompt(gameType, useTransliteration)` - selects appropriate prompt
- `shouldUseTransliteration(filename)` - detects files by keywords: culture, dynasty, names, character_name, name_list
- Game-specific transliteration prompts using proper nouns dictionary instead of general glossary

**Game-Specific Parsing** (`scripts/parser/yaml.ts`):
- Preserves CK3 variables (`$k_france$`, `[GetTitle]`, `#bold#`)
- Converts file naming: `*_l_english.yml` → `___*_l_korean.yml`

**Smart Caching System** (`scripts/utils/cache.ts`):
- Content-based hashing to detect source changes
- Translation memory with manual dictionary overrides
- Unified cache key structure for all games:
  - Translation: `gameType:text`
  - Transliteration: `gameType:transliteration:text`
- Persistent storage to avoid retranslation

**Translation Validation** (`scripts/utils/translation-validator.ts`):
- Detects incorrectly translated items based on validation rules
- Validates preservation of technical identifiers (snake_case like `mod_icon_*`)
- Ensures game variables in brackets remain untranslated (e.g., `[region|E]`, `[GetTitle]`)
- Checks for unwanted LLM responses in translations
- Used by retranslation script to find items that need re-translation

**Dictionary Management** (`scripts/utils/dictionary.ts`, `dictionaries/` directory, and `scripts/add-dict-from-commit.ts`):
- **External dictionary files**: All dictionaries are stored as TOML files in the `dictionaries/` directory
  - `dictionaries/ck3-glossary.toml` - CK3 general terms (~33 entries)
  - `dictionaries/ck3-proper-nouns.toml` - CK3 proper nouns (~700 entries)
  - `dictionaries/stellaris.toml` - Stellaris dictionary (~10 entries)
  - `dictionaries/vic3.toml` - VIC3 dictionary (~2 entries)
- **TOML format**: Simple key-value pairs with support for comments
  - Example: `"duke" = "공작"` or `"high king" = "고왕"`
  - Comments use `#` (not `//`)
  - Keys with special characters or spaces must be quoted
- **Dynamic loading**: `scripts/utils/dictionary.ts` loads dictionaries from TOML files at runtime using `@iarna/toml` parser
- Manual translation dictionary for game-specific terms and proper nouns
- Separate dictionaries for each game type (CK3, Stellaris, VIC3)
- Two dictionary types: general glossary (for translation) and proper nouns (for transliteration)
- `add-dict-from-commit.ts` script extracts Korean translations from git commits and adds them to TOML dictionary files
  - Extracts entries from `*_l_korean.yml` files in the commit
  - Matches English source text from upstream files automatically
  - Automatically writes to the appropriate TOML file based on game type
  - CK3 entries are added to `ck3-glossary.toml` (proper nouns can be manually moved to `ck3-proper-nouns.toml`)
  - Stellaris entries go to `stellaris.toml`, VIC3 entries to `vic3.toml`
- Supports automatic duplicate detection when adding entries
- Usage: `pnpm add-dict <commit-id>` to import translations from a specific commit
- **Editing**: Dictionary files can be edited directly without code changes, just restart the application

### Transliteration Mode

The system automatically switches between **translation** (번역) and **transliteration** (음역) based on file naming patterns and key patterns.

**When to use each mode**:
- **Translation**: Semantic meaning conversion for general game content (events, modifiers, decisions, etc.)
- **Transliteration**: Phonetic conversion for proper nouns (culture names, dynasty names, character names)

#### File-level Transliteration

**Automatic detection** (`shouldUseTransliteration(filename)`):
Files are automatically processed in transliteration mode when the filename contains:
- `culture` or `cultures` - Culture name files
- `dynasty` or `dynasties` - Dynasty name files
- `names` - Name list files
- `character_name` - Character name files
- `name_list` - Name list files

**Examples**:
```typescript
// Transliteration mode (automatic)
shouldUseTransliteration("culture_name_lists_l_english.yml")  // → true
shouldUseTransliteration("wap_dynasty_names_l_english.yml")   // → true
shouldUseTransliteration("character_names_l_english.yml")     // → true

// Translation mode (automatic)
shouldUseTransliteration("events_l_english.yml")              // → false
shouldUseTransliteration("modifiers_l_english.yml")           // → false
```

#### Key-level Transliteration

**Automatic detection** (`shouldUseTransliterationForKey(key)`):
Even within regular translation files, specific key patterns are processed in transliteration mode:

**Dynasty name patterns**:
- `dynn_*` - Dynasty names (e.g., `dynn_Austmadur`, `dynn_RICE_leslie`)
- `dynnp_*` - Dynasty prefixes (e.g., `dynnp_al-`, `dynnp_de`, `dynnp_banu`)

**Proper noun suffix patterns**:
- `*_adj` - Adjectival proper nouns (e.g., `dyn_c_pingnan_guo_adj`)
- `*_name` - Names (e.g., `dynasty_name`, `culture_name`)

**Exclusion rules**:
- Keys ending with `*_desc`, `*_event`, `*_decision` use semantic translation
- Context-based keys (descriptions, events, decisions) require semantic translation

**Examples**:
```typescript
// Key-level transliteration (in regular translation files)
shouldUseTransliterationForKey("dynn_Austmadur")        // → true (dynasty name)
shouldUseTransliterationForKey("dynnp_al-")             // → true (dynasty prefix)
shouldUseTransliterationForKey("culture_adj")           // → true (_adj suffix)
shouldUseTransliterationForKey("dynasty_name")          // → true (_name suffix)
shouldUseTransliterationForKey("heritage_desc")         // → false (_desc suffix)
shouldUseTransliterationForKey("culture_event")         // → false (_event suffix)
```

**Result example**:
```yaml
# Within events_l_english.yml (regular translation file)
dynn_Austmadur:0 "Austmadur"        → "아우스트마두르" (transliteration)
culture_name:0 "Korean"              → "한국인" (transliteration)
culture_adj:0 "Korean"               → "한국의" (transliteration)
heritage_desc:0 "Korean heritage"    → "한국 유산" (semantic translation)
```

#### How it works

1. File is detected during processing in `factory/translate.ts`
2. `shouldUseTransliteration(filename)` determines file-level mode
3. For each key, `shouldUseTransliterationForKey(key)` may override to transliteration mode
4. Appropriate prompt is selected: `CK3_TRANSLITERATION_PROMPT` vs `CK3_SYSTEM_PROMPT`
5. Proper nouns dictionary is used instead of general glossary
6. Cache key includes `transliteration:` prefix to separate from translations
7. Both modes use the same YAML output format

**Result differences**:
```
File: culture_name_lists_l_english.yml (transliteration mode)
"Afar" → "아파르" (phonetic)
"Anglo-Saxon" → "앵글로색슨" (phonetic)
"Bolghar" → "볼가르" (phonetic)

File: events_l_english.yml (translation mode)
"the culture" → "문화" (semantic)
"dynasty name" → "왕조 이름" (semantic)

File: events_l_english.yml, Key: dynn_Leslie (key-level transliteration)
"Leslie" → "레슬리" (phonetic, overrides file-level translation mode)
```

**Benefits**:
- Maintains consistency in proper noun transliteration
- Prevents semantic translation errors for names (e.g., "Afar" as "멀리" meaning "far away")
- Uses established proper nouns dictionary for historical accuracy
- Supports both file-level and key-level detection
- Completely automatic - no manual configuration needed
- Separate caching ensures no conflicts between modes

**Related files**:
- `scripts/utils/prompts.ts` - Mode detection and prompt selection (`shouldUseTransliteration`, `shouldUseTransliterationForKey`)
- `scripts/factory/translate.ts` - Mode integration in translation pipeline
- `scripts/utils/dictionary.ts` - Dictionary loader (reads from TOML files)
- `dictionaries/ck3-proper-nouns.toml` - Separate proper nouns dictionary for CK3
- `scripts/utils/dictionary-invalidator.ts` - Handles transliteration files in update-dict
- `scripts/utils/retranslation-invalidator.ts` - Handles transliteration files in retranslate and validates semantic translations

### Transliteration Validation in Retranslate

The `retranslate` command (`pnpm ck3:retranslate`) now includes intelligent validation for transliteration files to detect semantic translations that should be transliterations.

**How it works**:
1. When processing files that match transliteration patterns (culture, dynasty, names), the validation system checks if translations are semantic rather than phonetic
2. Uses heuristics to detect semantic translations:
   - **Syllable mismatch**: Flags translations that are disproportionately longer than the source (3x+ for short texts ≤10 chars, indicating descriptive translation)
3. Items detected as semantic translations are automatically invalidated and will be re-translated in transliteration mode

**Example detection**:
```
File: culture_names_l_korean.yml (transliteration file)
"Test" → "매우긴설명문장입니다정말긴데요" (❌ Detected: 4 chars → 15 chars, 3.75x ratio)
"Algonquian" → "알곤킨" (✅ Valid: appropriate transliteration length)
```

**Benefits**:
- Automatically finds and fixes semantic translations in transliteration files
- No need for separate migration scripts
- Works with existing validation infrastructure
- Only invalidates items that actually need re-translation

**Usage**:
```bash
# Run retranslate to detect and fix semantic translations in transliteration files
pnpm ck3:retranslate

# Then run normal translation to re-translate in transliteration mode
pnpm ck3
```

### Directory Structure

```
ck3/                    # CK3 mods to translate
├── RICE/              # "Rajas of Asia in CK3 Events" mod
├── VIET/              # "VIET Events" mod
└── [MOD_NAME]/        # Pattern for additional mods
    ├── meta.toml      # Configuration
    ├── upstream/      # Original English files
    └── mod/           # Generated Korean translations

dictionaries/           # Translation dictionaries (TOML format)
├── ck3-glossary.toml          # CK3 general terms
├── ck3-proper-nouns.toml      # CK3 proper nouns (names, places)
├── stellaris.toml             # Stellaris dictionary
└── vic3.toml                  # VIC3 dictionary

prompts/                # AI translation prompts (Markdown format)
├── ck3-translation.md         # CK3 translation prompt
├── ck3-transliteration.md     # CK3 transliteration prompt
├── stellaris-translation.md   # Stellaris translation prompt
├── stellaris-transliteration.md
├── vic3-translation.md        # VIC3 translation prompt
└── vic3-transliteration.md

scripts/
├── ck3.ts            # Main entry point
├── factory/          # Translation processing
├── parser/           # File parsing (TOML, YAML)
└── utils/            # AI, caching, logging utilities
    ├── dictionary.ts      # Dictionary loader (reads TOML files)
    └── prompts.ts         # Prompt loader
```

## Editing Dictionaries and Prompts

### Editing Dictionaries

Dictionaries are stored as TOML files in the `dictionaries/` directory and can be edited directly without modifying code.

**TOML Format Rules**:
```toml
# Comments start with # (not //)
"key" = "value"
"key with spaces" = "번역값"
"key-with-special-chars" = "번역값"

# Empty values are allowed
"the" = ""
```

**Important Notes**:
- Keys with spaces, special characters, or Unicode must be quoted
- Values must always be quoted
- Use `#` for comments, not `//`
- After editing, the application will load the new values on next run

**Example edits**:
```bash
# Edit CK3 glossary
nano dictionaries/ck3-glossary.toml

# Add a new term
echo '"new_term" = "새 용어"' >> dictionaries/ck3-glossary.toml

# Sort all dictionaries alphabetically (recommended after manual edits)
pnpm sort-dict

# Verify TOML syntax (if needed)
pnpm test scripts/utils/dictionary.test.ts
```

**Dictionary Sorting**:
- Dictionary files should be kept sorted alphabetically for better maintainability
- Use `pnpm sort-dict` to sort all dictionary files within their comment groups
- The sorting preserves:
  - Comment block groupings (entries between blank lines)
  - Inline comments (e.g., `"key" = "value" # comment`)
  - File structure and formatting
- After adding new dictionary entries, always run `pnpm sort-dict` to maintain consistent ordering

### Editing Prompts

Prompts are stored as Markdown files in the `prompts/` directory and support template substitution.

**Template Variables**:
- `{{TRANSLATION_MEMORY}}` - Automatically replaced with glossary dictionary
- `{{PROPER_NOUNS_DICTIONARY}}` - Automatically replaced with proper nouns dictionary

**Example edits**:
```bash
# Edit CK3 translation prompt
nano prompts/ck3-translation.md

# Edit CK3 transliteration prompt
nano prompts/ck3-transliteration.md
```

**Testing Changes**:
```bash
# Run tests to verify changes
pnpm test

# Run a translation to test the new dictionary/prompt
pnpm ck3
```

## Development Notes

- Uses TypeScript with jiti for direct execution
- Google Gemini AI integration requires `GOOGLE_GENERATIVE_AI_API_KEY` environment variable
- File hashing system prevents unnecessary retranslation of unchanged content
- Translation dictionaries in `dictionaries/*.toml` provide manual overrides (loaded by `scripts/utils/dictionary.ts`)
- Logging system supports different verbosity levels via `scripts/utils/logger.ts`

### Tool Usage Guidelines for AI Assistants

**Important**: When GitHub MCP (Model Context Protocol) server tools are available, **ALWAYS prioritize them over direct git commands**.

**Why use GitHub MCP server tools:**
- Provide structured, parsed output that's easier to work with
- Built-in error handling and retry logic
- Type-safe interfaces with clear parameters
- Better integration with AI workflows
- Avoid parsing raw command-line output

**GitHub MCP server tools available:**
- `github-mcp-server-get_commit` - Get commit details with diffs and stats
- `github-mcp-server-list_commits` - List commits with filtering options
- `github-mcp-server-get_file_contents` - Get file contents at specific refs
- `github-mcp-server-search_code` - Search code across repositories
- `github-mcp-server-list_branches` - List repository branches
- `github-mcp-server-list_tags` - List repository tags
- And many more (see tool descriptions for full list)

**When to use each approach:**

1. **GitHub repository operations** → Use GitHub MCP server tools
   - Getting commit information: `github-mcp-server-get_commit` instead of `git show`
   - Listing commits: `github-mcp-server-list_commits` instead of `git log`
   - Viewing file contents: `github-mcp-server-get_file_contents` instead of `git show HEAD:path`
   - Searching code: `github-mcp-server-search_code` instead of `git grep`
   - Listing branches/tags: `github-mcp-server-list_branches/list_tags` instead of `git branch`/`git tag`

2. **Local repository operations** → Use git commands
   - Staging changes: `git add`
   - Committing: `git commit`
   - Checking local status: `git status`
   - Local diffs: `git diff`

**Example patterns:**

```bash
# ❌ Avoid: Using git commands for GitHub data
git log --oneline -n 10
git show abc123

# ✅ Prefer: Using GitHub MCP server tools
# Use github-mcp-server-list_commits
# Use github-mcp-server-get_commit with sha="abc123"
```

**Note**: For operations that modify the repository (add, commit, push), continue using the `report_progress` tool as specified in the main guidelines, which handles git operations automatically.

### Translation Refusal Handling

The system includes comprehensive handling for AI translation refusals (e.g., content policy violations, safety filters):

**Automatic Tracking**:
- Translation refusals are automatically detected during the translation process
- Failed items are collected with context: mod, file, key, and original message
- Intermediate progress is saved when a refusal occurs (graceful degradation)

**Output Format**:
- Untranslated items are exported to `{game}-untranslated-items.json`
- JSON format includes timestamp and structured item list
- Each item contains: `mod`, `file`, `key`, `message`

**GitHub Integration**:
- Workflow automatically creates GitHub Issues for translation refusals
- Issues are grouped by mod with label `translation-refused` and game-specific labels
- Duplicate issues are avoided by checking for existing open issues
- Long messages are collapsed in expandable details sections

**Example output structure**:
```json
{
  "gameType": "ck3",
  "timestamp": "2025-12-08T01:00:00.000Z",
  "items": [
    {
      "mod": "RICE",
      "file": "events_l_english.yml",
      "key": "event.1.desc",
      "message": "Original English text..."
    }
  ]
}
```

**Related files**:
- `scripts/factory/translate.ts` - Refusal detection and collection
- `.github/workflows/translate-{game}.yml` - Issue creation automation

### Dictionary Update Optimization

The `update-dict` command now supports **filtering by Git commit history** to avoid invalidating too many translations unnecessarily.

**Usage patterns**:

1. **Full dictionary invalidation** (default, original behavior):
   ```bash
   pnpm ck3:update-dict
   ```
   Invalidates all translations containing any dictionary word. Use this when you're unsure which keys changed.

2. **Specific commit only**:
   ```bash
   pnpm ck3:update-dict -- --since-commit abc123
   ```
   Only invalidates translations for dictionary keys that were added or modified in the specified commit `abc123`.

3. **Commit range**:
   ```bash
   pnpm ck3:update-dict -- --commit-range abc123..def456
   ```
   Only invalidates translations for dictionary keys changed between two commits.

4. **Since a date**:
   ```bash
   pnpm ck3:update-dict -- --since-date "2024-01-01"
   pnpm ck3:update-dict -- --since-date "1 week ago"
   ```
   Only invalidates translations for dictionary keys changed since a specific date. Accepts ISO 8601 format or Git date expressions.

**How it works**:
- The tool analyzes `git log -p` output for `dictionaries/*.toml` files
- Extracts keys from lines starting with `+` (additions) in TOML dictionary files
- Only invalidates translations containing those specific keys
- Significantly reduces the number of translations to re-translate

**Example workflow**:
```bash
# After adding new dictionary entries to TOML files
git add dictionaries/ck3-glossary.toml
git commit -m "Add new dictionary entries"

# Only invalidate translations for the newly added keys in the current commit
pnpm ck3:update-dict -- --since-commit HEAD

# Then run translation to update only affected items
pnpm ck3
```

### GitHub Actions Workflows

The project uses separate GitHub Actions workflows for different translation invalidation scenarios:

**1. Dictionary Update Workflow** (`.github/workflows/invalidate-on-dictionary-update.yml`):
- **Trigger**: Automatically runs when `dictionaries/**` or `scripts/utils/dictionary.ts` is modified and pushed to main
- **Purpose**: Invalidates translations affected by dictionary changes
- **Commands executed**: `pnpm {game}:update-dict -- --since-commit {sha}`
- **Commit message**: "chore: 단어사전 업데이트에 따른 번역 무효화 [skip ci]"
- **When to use**: When you add or modify TOML dictionary files or the dictionary loader

**2. Retranslation Workflow** (`.github/workflows/retranslate-invalid-translations.yml`):
- **Trigger**: Runs on schedule (weekly, every Sunday at midnight) or manual dispatch
- **Purpose**: Finds and re-translates items that failed validation rules
- **Commands executed**: `pnpm {game}:retranslate`
- **Commit message**: "chore: 유효하지 않은 번역 재번역 [skip ci]"
- **When to use**: To periodically clean up incorrectly translated items (e.g., items with untranslated technical identifiers)

**3. Transliteration Files Change Workflow** (`.github/workflows/invalidate-on-transliteration-files-change.yml`):
- **Trigger**: Automatically runs when `**/meta.toml` files are modified and pushed to main
- **Purpose**: Invalidates translations when files are added/removed from `transliteration_files` option
- **Commands executed**: `pnpm invalidate-transliteration-files -- --since-commit {sha}`
- **Commit message**: "chore: transliteration_files 변경에 따른 번역 무효화 [skip ci]"
- **When to use**: When you add or remove files from the `transliteration_files` array in meta.toml
- **Why needed**: Files need to be retranslated when switching between semantic translation and transliteration mode

**4. Game Translation Workflows** (`.github/workflows/translate-{game}.yml`):
- **Trigger**: Runs on schedule (hourly at different minutes) or when upstream files change
- **Purpose**: Main translation process for each game
- **Commands executed**: `pnpm {game}`
- **Commit message**: "chore({game}): 번역 파일 업데이트 [skip ci]"

**Concurrency control**: All workflows use the same `translation` concurrency group to prevent simultaneous execution, ensuring commits remain clear and separate.

### GitHub Actions Shared Package

The project includes a shared package (`@pat-actions/shared`) that provides common utilities for GitHub Actions:

**Location**: `.github/actions/shared/`

**Purpose**: 
- Eliminates code duplication across multiple composite actions
- Provides GitHub API retry logic with exponential backoff
- Handles rate limits (403, 429) and server errors (5xx)

**Contents**:
- `github-retry.cjs`: Retry wrapper for GitHub API calls with automatic exponential backoff
- Backoff intervals: [1s, 2s, 8s, 10s, 60s]
- Respects `Retry-After` headers

**Usage in composite actions**:
```json
{
  "dependencies": {
    "@pat-actions/shared": "file:../shared"
  }
}
```

```javascript
const { githubApiRetry } = require('@pat-actions/shared');

// Wrap GitHub API calls with automatic retry
const result = await githubApiRetry(() => github.rest.issues.create({...}));
```

**Actions using the shared package**:
- `create-untranslated-issues`: Creates GitHub issues for translation refusals
- `close-translation-issues`: Closes resolved translation refusal issues

**Maintenance**: 
- This is a local npm package using the `file:` protocol
- Changes are automatically picked up when actions run `npm ci`
- See `.github/actions/shared/README.md` for details

### Code Style Guidelines

**Important**: All code comments and test names should be written in Korean.

**Comments**:
- Write all comments in Korean (한국어로 주석 작성)
- This includes inline comments, block comments, and documentation comments
- Example: `// 파일이 존재하지 않으면 원본에서 복사` instead of `// File doesn't exist, copy from source`

**Test Names**:
- All test descriptions in `describe()` and `it()` should be in Korean
- Example: `describe('캐시', () => { it('캐시 값을 저장하고 조회할 수 있어야 함', () => { ... })` 
- Instead of: `describe('cache', () => { it('should store and retrieve cache value', () => { ... })`

**Rationale**:
- The project is maintained by Korean developers and contributors
- Korean comments and test names improve readability and maintainability for the team
- Test output in Korean makes it easier to understand test failures and debugging

### Testing

**Important**: When modifying scripts in the `scripts/` directory, **ALWAYS run tests** to validate your changes.

**Test commands**:
```bash
# Run all tests
pnpm test

# Run tests in watch mode during development
pnpm test:watch

# Run tests with UI
pnpm test:ui

# Run tests with coverage report
pnpm test:coverage
```

**Testing guidelines**:
- Run `pnpm test` **before** making changes to understand the current test state
- Run `pnpm test` **after** making changes to ensure no regressions
- When adding new utility functions or modifying existing ones, verify that related tests pass
- Test files are located alongside the source code with `.test.ts` extension
- The test framework is Vitest, configured in `vitest.config.ts`
- All tests in `scripts/**/*.test.ts` are automatically discovered and run

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

### Documentation Guidelines

**Important**: Do NOT create analysis, verification, summary, or temporary markdown files in the repository root.

**Prohibited file types** (automatically excluded by `.gitignore`):
- Analysis files: `*_ANALYSIS.md`, `CRASH_ANALYSIS.md`
- Verification/result files: `*_RESULTS.md`, `VERIFICATION_*.md`
- Summary files: `*_SUMMARY.md`, `IMPLEMENTATION_*.md`, `ISSUE_RESOLUTION_*.md`
- Fix documentation: `*_FIX*.md`
- Korean analysis files: `*_결과_*.md`, `*_요약*.md`, `*_해결_*.md`, `크래시_*.md`, `실행_*.md`

**Acceptable markdown files:**
- `README.md` - Main project documentation
- `AGENTS.md` - This file, for AI agent guidance
- Tool-specific READMEs in subdirectories (e.g., `scripts/*/README.md`)

**Guidelines for AI agents:**
- Do NOT create markdown files for planning, notes, or tracking—work in memory instead
- Only create markdown files when the user explicitly asks for a specific file by name or path
- Analysis results, verification reports, and summaries should be communicated directly to the user in the chat, not saved as files
- If temporary documentation is needed during development, create it in `/tmp` directory

## Testing Guidelines for AI Assistants

### Test Execution

**Always run tests before and after making changes:**
```bash
# Run all tests
pnpm test

# Run specific test file
pnpm test -- prompts

# Run tests in watch mode during development
pnpm test:watch

# Run tests with coverage
pnpm test:coverage
```

### Test Writing Principles

**DO NOT write tests for:**
- **Library/OS API wrapper behavior** - Testing external dependencies like xxhash-wasm unicode handling, Node.js statfsSync calls
  - Reason: Tests external code, not our business logic
- **Timing/implementation details** - Testing queue.ts backoff intervals, setTimeout precision
  - Reason: Implementation changes break tests without guaranteeing correctness
- **Static string content validation** - Testing if CK3_SYSTEM_PROMPT contains specific keywords
  - Reason: Tests constants, not logic; creates maintenance burden
- **Tautological tests** - Tests that duplicate implementation logic
  - Reason: Only fails if test code changes, doesn't protect against bugs

**DO write tests for:**
- **Business logic** - Application-specific behavior like `getLocalizationFolderName()`
- **Function logic** - Input→output mapping, error handling
- **Data transformation** - File name conversion, path mapping rules

### Test Quality Checklist

Before committing tests, verify:

**Basic Requirements:**
- [ ] Tests cover all branches (if/else, switch cases)
- [ ] Tests cover error handling paths
- [ ] Tests cover boundary values (empty string, null, undefined, 0, negative)
- [ ] Test names clearly describe what is being tested

**Avoid Anti-patterns:**
- [ ] No tautological tests (copying implementation logic)
- [ ] No external dependency behavior tests
- [ ] No timing/implementation detail dependencies
- [ ] No static string content validation

**Good Test Characteristics:**
- [ ] Tests verify business logic
- [ ] Test failures clearly indicate what broke
- [ ] Tests run independently (no dependencies on other tests)
- [ ] Tests execute quickly (minimal external API calls or file system access)

### Test Examples

**✅ Good Example: Complete branch coverage**
```typescript
describe('getSystemPrompt', () => {
  it('returns translation prompt in translation mode', () => {
    expect(getSystemPrompt('ck3', false)).toBe(CK3_SYSTEM_PROMPT)
  })
  
  it('returns transliteration prompt in transliteration mode', () => {
    expect(getSystemPrompt('ck3', true)).toBe(CK3_TRANSLITERATION_PROMPT)
  })
  
  it('throws error for unsupported game type', () => {
    expect(() => getSystemPrompt('invalid')).toThrow()
  })
})
```

**❌ Bad Example: Tautological test**
```typescript
describe('file name conversion', () => {
  it('adds ___ prefix', () => {
    // This duplicates the implementation logic
    const result = '___' + fileName.replace('_l_english', '_l_korean')
    expect(result).toBe('___file_l_korean.yml')
  })
})
```

**❌ Bad Example: Static string validation**
```typescript
describe('prompt content', () => {
  it('contains specific keywords', () => {
    // Tests constant value, not logic
    expect(CK3_SYSTEM_PROMPT).toContain('Crusader Kings III')
  })
})
```

### When Modifying Scripts

1. **Before changes**: Run `pnpm test` to understand current test state
2. **After changes**: Run `pnpm test` to ensure no regressions
3. **Adding new functions**: Add corresponding tests following the principles above
4. **Modifying existing functions**: Update tests to match new behavior
5. **All tests must pass**: 331 tests should pass before committing

### Test File Locations

Tests are colocated with source files using `.test.ts` extension:
- `scripts/utils/prompts.ts` → `scripts/utils/prompts.test.ts`
- `scripts/factory/translate.ts` → `scripts/factory/translate.test.ts`

All tests in `scripts/**/*.test.ts` are automatically discovered by Vitest.
