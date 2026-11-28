import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { ROUTES } from '@/lib/constants';

/**
 * Architecture guards.
 *
 * Campus+ has hard, non-negotiable product rules. Rather than trusting review,
 * these tests read the source tree and fail when a rule is broken: no AI, no
 * unguarded uploads, no raw HTML, no presence, no secrets in the browser bundle.
 */

const ROOT = process.cwd();

function walk(dir, filter, out = []) {
  const absolute = path.join(ROOT, dir);
  if (!fs.existsSync(absolute)) return out;
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const relative = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(relative, filter, out);
    else if (filter(relative)) out.push(relative);
  }
  return out;
}

const appFiles = walk('app', (file) => /\.(js|jsx)$/.test(file));
const componentFiles = walk('components', (file) => /\.(js|jsx)$/.test(file));
const libFiles = walk('lib', (file) => /\.js$/.test(file));
const allSource = [...appFiles, ...componentFiles, ...libFiles];

const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const grep = (files, pattern) =>
  files.filter((file) => pattern.test(read(file)));

describe('no artificial intelligence anywhere (spec §2)', () => {
  const providers = /openai|anthropic|claude|gemini|groq|ollama|huggingface|langchain|cohere|mistral|vertex-ai/i;

  it('does not depend on an AI or vector SDK', () => {
    const pkg = JSON.parse(read('package.json'));
    const dependencies = { ...pkg.dependencies, ...pkg.devDependencies };
    expect(Object.keys(dependencies).filter((name) => providers.test(name))).toEqual([]);
  });

  it('does not reference providers, embeddings or vector stores in executable code', () => {
    // Comments may legitimately *say* "no AI"; only code counts here.
    const codeOnly = (file) =>
      read(file)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((line) => !/^\s*\/\//.test(line))
        .join('\n');
    const offenders = allSource.filter(
      (file) =>
        providers.test(codeOnly(file)) ||
        /embeddings?|vector\s*(db|store|search)|pinecone|weaviate|pgvector/i.test(codeOnly(file)),
    );
    expect(offenders).toEqual([]);
  });

  it('keeps ranking deterministic — no ai/score-based feed ordering', () => {
    for (const file of walk('lib/data', (f) => f.endsWith('.js'))) {
      expect(read(file)).not.toMatch(/ai_|_ai\b|spam_score|toxicity/i);
    }
  });
});

describe('controlled media and storage boundaries', () => {
  it('limits image rendering to approved media surfaces', () => {
    const GIF_SURFACE = path.join('components', 'media', 'GifPicker.js');
    // Future upload previews must be limited to the reviewed storage component.
    const BRAND_SURFACE = path.join('components', 'brand', 'Brand.js');
    const imageUsers = grep([...appFiles, ...componentFiles], /<img[\s>]|from 'next\/image'|from "next\/image"/);
    const allowed = [BRAND_SURFACE, GIF_SURFACE, path.join('components', 'clubs', 'ClubLogo.js'), path.join('components', 'storage', 'FileUpload.js'), path.join('components', 'storage', 'ProfileAvatar.js'), path.join('components', 'posts', 'PostAttachments.js'), path.join('components', 'posts', 'DraftAttachments.js'), path.join('components', 'marketplace', 'MarketplaceGallery.js'), path.join('components', 'campus', 'LostFoundGallery.js'), path.join('components', 'campus', 'HousingGallery.js'), path.join('components', 'campus', 'RideGallery.js'), path.join('components', 'campus', 'TeamGallery.js'), path.join('components', 'campus', 'ProjectGallery.js'), path.join('components', 'campus', 'GigGallery.js'), path.join('components', 'campus', 'AchievementGallery.js'), path.join('components', 'campus', 'NoticeGallery.js'), path.join('components', 'campus', 'EventGallery.js'), path.join('components', 'campus', 'SpaceGallery.js')];
    expect(imageUsers.filter((file) => !allowed.includes(file))).toEqual([]);
    expect(imageUsers).toContain(BRAND_SURFACE);
    expect(imageUsers).toContain(GIF_SURFACE);
    // That single surface must point at the validated provider hosts.
    const picker = read(GIF_SURFACE);
    expect(picker).toMatch(/giphy/i);
  });

  it('restricts file pickers to the designated reusable upload component', () => {
    // The allowlisted component does not exist yet; approval here is not an
    // authorization check or a substitute for reviewing the upload lifecycle.
    const controlledPickers = [path.join('components', 'storage', 'FileUpload.js'), path.join('components', 'posts', 'PostAttachments.js'), path.join('components', 'posts', 'DraftAttachments.js'), path.join('components', 'marketplace', 'MarketplaceGallery.js')];
    const offenders = grep([...appFiles, ...componentFiles], /<input\b[^>]*(?:type\s*=\s*(?:["']file["']|\{)|accept\s*=)|createElement\s*\(\s*["']input["']/s);
    expect(offenders.filter((file) => !controlledPickers.includes(file))).toEqual([]);
    expect(read('components/ui/fields.js')).toMatch(/props\.type\.toLowerCase\(\) === 'file'/);
  });

  it('keeps the upload provider and its credentials server-only', () => {
    const frontend = [...appFiles.filter((file) => !file.startsWith('app/api/')), ...componentFiles];
    expect(grep(frontend, /(?:drive\.google\.com|googleapis\.com\/(?:upload\/)?drive|script\.google\.com|GOOGLE_APPS_SCRIPT_|provider_file_id|@\/lib\/storage(?:\/|['"]))/i)).toEqual([]);
    expect(grep(allSource, /createAppsScriptProvider/).sort()).toEqual([
      path.join('lib', 'storage', 'google-apps-script.js'), path.join('lib', 'storage', 'index.js'),
    ].sort());
    expect(read('lib/storage/index.js')).toMatch(/^import 'server-only';/m);
    expect(read('lib/storage/google-apps-script.js')).toMatch(/^import 'server-only';/m);
  });

  it('never touches a storage bucket', () => {
    expect(grep(allSource, /\.storage\.|from\(['"][^'"]*bucket|supabase\.storage/)).toEqual([]);
  });

  it('keeps GIF references on the validated provider hosts', () => {
    // The picker and the composer both go through the single GIF client.
    expect(grep(allSource, /from '@\/lib\/giphy|@\/components\/media\/GifPicker/).length).toBeGreaterThan(0);

    // Hard-coded provider hostnames live only where they are validated:
    // the schema allow-list, the provider client, and the server config.
    const allowed = [
      path.join('lib', 'validation', 'schemas.js'),
      path.join('lib', 'giphy', 'index.js'),
    ];
    const hosts = grep(allSource, /giphy\.com/).sort();
    expect(hosts).toEqual([...allowed].sort());
  });
});

describe('no executable user html (spec §75)', () => {
  it('never uses dangerouslySetInnerHTML', () => {
    expect(grep(allSource, /dangerouslySetInnerHTML/)).toEqual([]);
  });

  it('never builds an html string with innerHTML', () => {
    expect(grep(allSource, /\.innerHTML\s*=|document\.write/)).toEqual([]);
  });
});

describe('no presence, no typing indicators (spec §8, §22)', () => {
  it('has no presence or typing code in the chat surface', () => {
    const chatFiles = [
      ...walk('components/chat', (f) => f.endsWith('.js')),
      ...walk('app/(shell)/(app)/chat', (f) => f.endsWith('.js')),
    ];
    // Channels are private broadcast only: no presence events, no typing state.
    for (const file of chatFiles) {
      const code = read(file)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((line) => !/^\s*\/\//.test(line))
        .join('\n');
      expect(code).not.toMatch(/typing|is_online|last_seen_at|presence_/i);
      expect(code).not.toMatch(/\.on\('presence'|track\(|untrack\(/);
    }
  });

  it('keeps the only delivery vocabulary in messages: Sent and Seen', () => {
    const thread = read('components/chat/ChatThread.js');
    expect(thread).toMatch(/Seen/);
    expect(thread).toMatch(/Sent/);
  });
});

describe('secrets never reach the browser bundle (spec §74, §93)', () => {
  it('exposes only the declared public variables (two Supabase + public config)', () => {
    const publicVars = new Set();
    for (const file of allSource) {
      for (const match of read(file).matchAll(/NEXT_PUBLIC_[A-Z0-9_]+/g)) publicVars.add(match[0]);
    }
    // Only public, non-secret configuration. Anything secret-looking in a
    // NEXT_PUBLIC_ variable would be shipped to the browser.
    expect([...publicVars].sort()).toEqual([
      'NEXT_PUBLIC_COLLEGE_NAME',
      'NEXT_PUBLIC_KLIPY_APP_KEY',
      'NEXT_PUBLIC_LEGAL_CONTACT_EMAIL',
      'NEXT_PUBLIC_LOCAL_PREVIEW',
      'NEXT_PUBLIC_PLATFORM_NAME',
      'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
      'NEXT_PUBLIC_SUPABASE_URL',
      'NEXT_PUBLIC_TRENDING_FULL_SCALE',
      'NEXT_PUBLIC_TRENDING_WINDOW_HOURS',
    ]);
    const secretish = [...publicVars].filter((name) => /SECRET|SERVICE|TOKEN|PASSWORD|PRIVATE_KEY/.test(name));
    expect(secretish).toEqual([]);
  });

  it('keeps secrets behind the server-only module', () => {
    const serverConfig = read('lib/config.server.js');
    expect(serverConfig).toMatch(/^import 'server-only';/m);
    expect(serverConfig).toMatch(/SUPABASE_SECRET_KEY/);
    expect(serverConfig).toMatch(/GIPHY_API_KEY/);

    for (const file of [...appFiles, ...componentFiles]) {
      const source = read(file);
      const isServerFile = !source.startsWith("'use client'");
      if (isServerFile) continue; // server code may legitimately name a secret
      expect(source).not.toMatch(/SUPABASE_SECRET_KEY|GIPHY_API_KEY|SERVICE_ROLE/);
    }
  });

  it('sends client components through the browser-safe config only', () => {
    for (const file of componentFiles) {
      const source = read(file);
      if (!source.startsWith("'use client'")) continue;
      expect(source).not.toMatch(/@\/lib\/config\.server/);
    }
  });
});

describe('route surface (spec §5, §6)', () => {
  const exists = (route) => {
    const candidates = [
      path.join(ROOT, 'app', route, 'page.js'),
      path.join(ROOT, 'app', '(shell)', '(app)', route, 'page.js'),
      path.join(ROOT, 'app', '(shell)', '(public)', route, 'page.js'),
    ];
    return candidates.some((candidate) => fs.existsSync(candidate));
  };

  it('exposes every route the specification lists', () => {
    const required = [
      '/', '/setup', '/login', '/login/verify', '/onboarding', '/account-status', '/rules',
      '/home', '/explore', '/market', '/communities', '/campus', '/chat',
      '/profile', '/settings', '/notifications', '/moderator', '/admin',
      '/user/[username]', '/post/[id]', '/community/[slug]', '/market/listing/[id]',
      '/gigs', '/gigs/new', '/gigs/[id]', '/gigs/[id]/edit',
      '/clubs', '/clubs/new', '/clubs/[id]', '/clubs/[id]/edit',
      // The pre-section addresses stay routable: they redirect, so old
      // notifications and bookmarks keep working.
      '/market/gigs/[id]', '/campus/events/[id]', '/campus/clubs/[id]',
      '/campus/noticeboard/[id]', '/explore/resources/[id]', '/explore/opportunities/[id]',
      '/explore/projects/[id]', '/chat/[id]',
    ];
    const missing = required.filter((route) => !exists(route));
    expect(missing).toEqual([]);
    // `/community/<slug>` is the spec's canonical deep link and must resolve
    // (the application serves `/communities/<slug>` and aliases the short form).
    expect(
      fs.existsSync(path.join(ROOT, 'app', 'community', '[slug]', 'page.js')) ||
        fs.existsSync(path.join(ROOT, 'app', '(shell)', '(app)', 'community', '[slug]', 'page.js')),
    ).toBe(true);
  });

  it('never gives a Random session a public url', () => {
    expect(fs.existsSync(path.join(ROOT, 'app', '(shell)', '(app)', 'random', '[id]'))).toBe(false);
    expect(fs.existsSync(path.join(ROOT, 'app', '(shell)', '(app)', 'random', '[session]'))).toBe(false);
    expect(typeof ROUTES.random === 'function' && ROUTES.random.length > 0).toBe(false);
  });

  it('ships loading states for the primary surfaces', () => {
    const withLoading = ['home', 'explore', 'market', 'gigs', 'clubs', 'communities', 'campus', 'chat', 'notifications', 'settings', 'moderator', 'admin', 'profile'];
    const missing = withLoading.filter(
      (route) => !fs.existsSync(path.join(ROOT, 'app', '(shell)', '(app)', route, 'loading.js')),
    );
    expect(missing).toEqual([]);
  });
});

describe('design system (spec §4)', () => {
  const globals = read('app/globals.css');
  const lumenTokens = read('app/tokens.css');
  const partials = ['surfaces', 'controls', 'feedback', 'interactive', 'navigation']
    .map((name) => read(`app/styles/${name}.css`))
    .join('\n');

  it('defines the semantic token set for both explicit themes', () => {
    for (const token of [
      '--c-canvas',
      '--c-surface',
      '--c-surface-2',
      '--c-ink',
      '--c-ink-soft',
      '--c-muted',
      '--c-line',
      '--c-line-strong',
      '--c-accent',
      '--c-accent-hover',
      '--c-accent-press',
      '--c-accent-deep',
      '--c-accent-soft',
      '--c-accent-tint',
      '--c-accent-pale',
      '--c-accent-highlight',
      '--c-accent-glass',
      '--c-accent-ink',
      '--c-on-accent',
      '--c-danger',
      '--c-success',
      '--c-warning',
      '--c-info',
      '--c-unread',
      '--c-glass-bg',
      '--c-glass-tint',
      '--c-glass-border',
    ]) {
      expect(globals).toContain(token);
    }
    // Both themes are explicit document attributes; there is no OS variant.
    expect(lumenTokens).toContain("[data-theme='light']");
    expect(lumenTokens).toContain("[data-theme='dark']");
    expect(globals).not.toContain("[data-theme='system']");
    expect(globals).not.toContain('@media (prefers-color-scheme: dark)');
    // The tokens are exposed to Tailwind as utilities.
    expect(globals).toContain('@theme inline');
  });

  it('keeps the Campus+ identity on the requested light and dark foundations', () => {
    expect(lumenTokens).toContain('--color-paper: #E9E3D9');
    expect(lumenTokens).toContain('--color-paper-2: #F7F3EC');
    expect(lumenTokens).toContain('--color-ink: #292725');
    expect(lumenTokens).toContain('--color-accent: #8DBCE3');
    expect(lumenTokens).toContain('--color-paper: #14181E');
    expect(lumenTokens).toContain('--color-paper-2: #1D232B');
    expect(lumenTokens).toContain('--color-ink: #F2F1EC');
    expect(lumenTokens).toContain('--color-accent: #92C3EA');
    expect(globals).toContain('--cp-bg-page: var(--color-paper)');
    expect(globals).toContain('--cp-bg-accent: var(--color-accent)');

    // Retired canvas and accent systems cannot quietly reappear in the
    // semantic bridge that every existing component consumes.
    for (const retired of ['#07151d', '#10242d', '#14b8a6', '#2dd4bf', '#f4e3c1', '#f97316', '#f7f5f1']) {
      expect(globals).not.toContain(retired);
    }
  });

  it('keeps hard-coded colors limited to browser chrome and theme defaults', () => {
    // Browser chrome needs strings at metadata/manifest time. The theme module
    // also needs the canonical sRGB equivalents for its browser-chrome sync.
    const CHROME_COLOUR_FILES = [path.join('app', 'layout.js'), path.join('lib', 'timetable', 'batch.js')];
    const LOCAL_COLOR_FILES = [path.join('lib', 'theme.js')];
    const offenders = allSource.filter((file) => {
      if (CHROME_COLOUR_FILES.includes(file) || LOCAL_COLOR_FILES.includes(file)) return false;
      return /#[0-9a-fA-F]{3,8}\b/.test(read(file));
    });
    expect(offenders).toEqual([]);

    expect(lumenTokens).toContain('--color-paper: #E9E3D9');
    expect(globals).toContain('--cp-bg-page: var(--color-paper)');
    // Static browser chrome and install metadata use the dark default; the
    // root effect updates the live meta value for an explicit light choice.
    const canvas = '#14181E';
    const mirrored = (file, pattern) => pattern.exec(read(file))?.[1];
    expect(
      mirrored(path.join('app', 'layout.js'), /<meta name="theme-color" content="(#[0-9a-fA-F]{3,8})" suppressHydrationWarning/),
    ).toBe(canvas);
    expect(
      mirrored(path.join('lib', 'timetable', 'batch.js'), /TIMETABLE_CANVAS_COLOR = '(#[0-9a-fA-F]{3,8})'/),
    ).toBe(canvas);
  });

  it('keeps glass, motion and the interactive materials inside the design system', () => {
    expect(partials).toContain('.glass {');
    expect(partials).toContain('.glass-soft');
    expect(partials).toContain('.glass-strong');
    expect(partials).toMatch(/prefers-reduced-motion/);
    expect(partials).toContain('.tilt__card');
    expect(partials).toContain('.wheel__option');

    // Glass is an accent: only a small, deliberate set of floating surfaces may
    // opt into their own backdrop blur on top of the primitives.
    const blurry = allSource.filter((file) => /backdrop-blur|backdrop-filter/.test(read(file)));
    expect(blurry.length).toBeLessThanOrEqual(8);
  });
});

describe('public configuration reaches the browser bundle (spec §91, §92)', () => {
  /*
   * `NEXT_PUBLIC_*` values only reach the browser because the bundler replaces
   * the exact expression `process.env.` + the variable name at build time. A
   * computed key into `process.env` is invisible to that replacement, so the
   * browser reads `undefined` while the server reads the real value.
   *
   * That is not hypothetical: `lib/config.js` used to read the Supabase URL and
   * publishable key that way, which made `getBrowserClient()` return `null` in
   * real browsers. Sign-out then silently did nothing — the session cookie
   * survived and the proxy bounced `/login` straight back to `/home` — while
   * every lint, test and build stayed green, because server-side code was
   * unaffected. These guards fail if that pattern comes back.
   */
  const codeOnly = (file) =>
    read(file)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((line) => !/^\s*\/\//.test(line))
      .join('\n');

  it('never reads a browser env var through a computed key', () => {
    // `server-only` modules are never bundled for the browser: a computed key
    // there is read from the real environment at request time and is fine.
    const serverOnly = /import 'server-only'|from 'server-only'|require\('server-only'\)/;
    const offenders = [...allSource, 'proxy.js'].filter(
      (file) => /process\.env\s*\[/.test(codeOnly(file)) && !serverOnly.test(read(file)),
    );
    expect(offenders).toEqual([]);
  });

  it('reads its own public Supabase configuration as literal member expressions', () => {
    const config = codeOnly(path.join('lib', 'config.js'));
    expect(config).toContain('process.env.NEXT_PUBLIC_SUPABASE_URL');
    expect(config).toContain('process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
    expect(config).not.toMatch(/process\.env\s*\[/);
  });

  it('keeps secrets out of anything a client component imports', () => {
    const clientReachable = allSource.filter((file) => /^'use client'/.test(read(file)));
    const leaked = clientReachable.filter((file) =>
      /SUPABASE_SECRET_KEY|GIPHY_API_KEY|service_role/.test(codeOnly(file)),
    );
    expect(leaked).toEqual([]);
  });
});
