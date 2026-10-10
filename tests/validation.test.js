import { describe, expect, it } from 'vitest';

import { validate } from '@/lib/validation/primitives';
import {
  accountStatusSchema,
  commentSchema,
  eventSchema,
  listingSchema,
  messageSchema,
  noticeSchema,
  onboardingSchema,
  opportunitySchema,
  postSchema,
  profileUpdateSchema,
  gifRefValidator,
} from '@/lib/validation/schemas';
import { LIMITS } from '@/lib/constants';

/**
 * Server-side validation. Every action validates before touching the database;
 * the database CHECK constraints are the second line of defence. These tests
 * pin the rules the specification calls out explicitly (§67, §74, §83).
 */

const expectFailure = (result, field) => {
  expect(result.ok).toBe(false);
  expect(result.errors[field]).toBeTruthy();
};

describe('validate()', () => {
  it('collects one error per invalid field and passes valid input through', () => {
    const broken = validate({ body: '', visibility: 'secret' }, postSchema);
    expect(broken.ok).toBe(false);
    expect(Object.keys(broken.errors).sort()).toEqual(['body', 'visibility']);

    const good = validate({ body: 'The lab is open until 6pm today.' }, postSchema);
    expect(good.ok).toBe(true);
    expect(good.data.visibility).toBe('campus');
    expect(validate({ body: 'Campus note.', visibility: 'public' }, postSchema).ok).toBe(false);
    expect(validate({ body: 'Campus note.', visibility: 'campus' }, postSchema).ok).toBe(true);

    const community = validate(
      {
        body: 'A note for this study group.',
        community_id: '00000000-0000-4000-8000-000000000001',
        visibility: 'community',
      },
      postSchema,
    );
    expect(community.ok).toBe(true);
  });

  it('trims text, collapses whitespace and strips control characters', () => {
    const ok = validate({ body: '  The   lab is\n\nopen until 6pm.  ' }, postSchema);  // blank lines preserved
    expect(ok.ok).toBe(true);
    expect(ok.data.body).toBe('The lab is\n\nopen until 6pm.');
    expect(validate({ body: 'hello\u0000\u200bworld' }, postSchema).data.body).toBe('helloworld');
  });

  it('keeps markup as plain text — Campus+ never interprets user html', () => {
    const result = validate({ body: '<script>alert(1)</script>' }, postSchema);
    expect(result.ok).toBe(true);
    // The value survives verbatim as text; rendering escapes it (no
    // dangerouslySetInnerHTML anywhere — enforced by ESLint and tests/spec.test.js).
    expect(result.data.body).toBe('<script>alert(1)</script>');
  });

  it('supports optional fields without inventing defaults', () => {
    const result = validate({ body: 'Meet at 4pm.' }, postSchema);
    expect(result.ok).toBe(true);
    expect(result.data.community_id).toBeNull();
  });
});

describe('onboarding and profile', () => {
  it('requires a username, a display name and rule acceptance', () => {
    expectFailure(validate({ username: 'ab', display_name: '', accept_rules: null }, onboardingSchema), 'username');
    const missingRules = validate(
      { username: 'asha_e2e', display_name: 'Asha', accept_rules: null },
      onboardingSchema,
    );
    expectFailure(missingRules, 'accept_rules');
  });

  it('rejects reserved and malformed usernames', () => {
    for (const username of ['admin', 'moderator', 'A', 'asha e2e', 'asha@e2e', 'a'.repeat(40)]) {
      const result = validate(
        { username, display_name: 'Asha', accept_rules: 'on' },
        onboardingSchema,
      );
      expect(result.ok).toBe(false);
    }
  });

  it('bounds the bio so a profile cannot become a document', () => {
    const result = validate({ display_name: 'Asha', bio: 'x'.repeat(LIMITS.bio.max + 1) }, profileUpdateSchema);
    expectFailure(result, 'bio');
    expect(validate({ display_name: 'Asha', bio: 'Second year, loves circuits.' }, profileUpdateSchema).ok).toBe(true);
  });
});

describe('posts, comments and messages', () => {
  it('enforces the text limits from constants', () => {
    expect(validate({ body: 'x'.repeat(LIMITS.post.max + 1) }, postSchema).ok).toBe(false);
    expect(validate({ body: 'x'.repeat(LIMITS.comment.max + 1) }, commentSchema).ok).toBe(false);
    expect(validate({ body: 'x'.repeat(LIMITS.message.max + 1) }, messageSchema).ok).toBe(false);
    expect(validate({ body: 'x'.repeat(LIMITS.post.min) }, postSchema).ok).toBe(true);
  });

  it('requires a message to have either text or a gif — never neither', () => {
    expect(validate({ body: '' }, messageSchema).ok).toBe(false);
    const gifOnly = validate(
      { body: '', gif: { id: 'abc123', url: 'https://media.giphy.com/media/abc123/giphy.gif' } },
      messageSchema,
    );
    expect(gifOnly.ok).toBe(true);
    expect(gifOnly.data.gif.preview).toBe('https://media.giphy.com/media/abc123/giphy.gif');
  });

  it('rejects blank-but-padded comments', () => {
    expect(validate({ body: '     ' }, commentSchema).ok).toBe(false);
  });
});

describe('marketplace listings', () => {
  const base = {
    title: 'Scientific calculator',
    description: 'Used for one semester, works perfectly.',
    category_id: '22222222-2222-4222-8222-222222222222',
  };

  it('accepts a free listing without a price', () => {
    const result = validate({ ...base, is_free: 'on' }, listingSchema);
    expect(result.ok).toBe(true);
    expect(result.data.is_free).toBe(true);
  });

  it('rejects a negative or non-numeric price', () => {
    expectFailure(validate({ ...base, price: '-5' }, listingSchema), 'price');
    expectFailure(validate({ ...base, price: 'free-ish' }, listingSchema), 'price');
  });

  it('asks for a condition whose value the database knows', () => {
    expectFailure(validate({ ...base, condition: 'perfect' }, listingSchema), 'condition');
  });
});

describe('official content (staff surfaces)', () => {
  const event = {
    title: 'TechTalk: systems',
    description: 'A talk in the main auditorium.',
    starts_on: '2026-11-01',
    location: 'Main auditorium',
  };

  it('accepts an event and validates the optional status when present', () => {
    expect(validate(event, eventSchema).ok).toBe(true);
    expect(validate({ ...event, status: 'published' }, eventSchema).ok).toBe(true);
    expectFailure(validate({ ...event, status: 'hidden' }, eventSchema), 'status');
  });

  it('refuses a past event date (staff cannot publish into the past)', () => {
    const past = validate({ ...event, starts_on: '2020-01-01' }, eventSchema);
    expectFailure(past, 'starts_on');
  });

  it('restricts a notice status to draft / published / archived', () => {
    const notice = { title: 'Library timings', body: 'The library closes at 8pm this week.', category: 'general' };
    expect(validate({ ...notice, status: 'draft' }, noticeSchema).ok).toBe(true);
    expectFailure(validate({ ...notice, status: 'hidden' }, noticeSchema), 'status');
  });

  it('only accepts safe external urls for opportunities', () => {
    const opportunity = {
      title: 'Summer internship',
      organization: 'PCCOE placements',
      description: 'Six week internship for second and third year students.',
      url: 'https://pccoepune.org/internships',
    };
    expect(validate(opportunity, opportunitySchema).ok).toBe(true);
    expect(validate({ ...opportunity, url: 'javascript:alert(1)' }, opportunitySchema).ok).toBe(false);
    expectFailure(validate({ ...opportunity, title: 'ab' }, opportunitySchema), 'title');
    expectFailure(validate({ ...opportunity, mode: 'teleport' }, opportunitySchema), 'mode');
  });
});

describe('administrative schemas', () => {
  it('accepts only the account statuses the database enum knows', () => {
    expect(validate({ status: 'suspended' }, accountStatusSchema).ok).toBe(true);
    expectFailure(validate({ status: 'shadowbanned' }, accountStatusSchema), 'status');
  });

  it('bounds a suspension duration', () => {
    expect(validate({ status: 'suspended', duration_days: '7' }, accountStatusSchema).ok).toBe(true);
    expectFailure(validate({ status: 'suspended', duration_days: '9999' }, accountStatusSchema), 'duration_days');
  });
});

describe('gif references are the only accepted media', () => {
  it('strips everything except the provider fields', () => {
    const result = gifRefValidator({
      id: 'abc123',
      url: 'https://media.giphy.com/media/abc123/giphy.gif',
      title: '<script>alert(1)</script>',
      extra: 'ignored',
    });
    expect(result.ok).toBe(true);
    expect(result.value.id).toBe('abc123');
    expect(result.value.extra).toBeUndefined();
  });
});
