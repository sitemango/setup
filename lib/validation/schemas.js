/**
 * Entity schemas — the single source of validation truth for both server
 * actions and API route handlers. Database CHECK constraints (§100 migration)
 * are the second line of defence, never the only one.
 */

import {
  LIMITS, USERNAME_REGEX, RESERVED_USERNAMES, ACCOUNT_STATUS, VISIBILITY, CONTENT_STATUS,
  REPORT_REASONS, REPORT_TARGET_TYPES, REPORT_STATUS, MARKETPLACE_CONDITIONS, LISTING_STATUS,
  NOTICE_CATEGORIES, RSVP_STATUS, BRANCHES, YEARS, DIVISIONS, RESOURCE_TYPES, EVENT_STATUS,
  SEMESTERS, MODERATION_ACTIONS, NOTIFICATION_TYPES, SOURCE_KIND,
  EVENT_CATEGORIES, OPPORTUNITY_CATEGORIES, STUDY_PURPOSES, STUDY_MODES, STUDY_AVAILABILITY,
} from '@/lib/constants';
import { emailDomain, normalizeEmail, normalizeUsername } from '@/lib/utils';
import {
  cleanText, fail, ok, validate, vArrayOf, vBoolean, vDate, vEnum, vNumber, vOptionalString,
  vString, vTime, vUrl, vUuid,
} from '@/lib/validation/primitives';

export { validate };

/* -------------------------------------------------------------------------- */
/* Identity                                                                    */
/* -------------------------------------------------------------------------- */

export function vInstitutionalEmail(input, { domains }) {
  const email = normalizeEmail(input);
  if (!email) return fail('Enter your institutional email address.');
  if (email.length > 254) return fail('That email address is too long.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail('That does not look like an email address.');
  const domain = emailDomain(email);
  const allowed = (domains || []).map((d) => String(d).toLowerCase().replace(/^@/, ''));
  if (!domain || !allowed.includes(domain)) {
    return fail(`Campus+ is limited to ${allowed.map((d) => `@${d}`).join(' or ')} email addresses.`);
  }
  return ok(email);
}

export function vUsername(input) {
  const username = normalizeUsername(input);
  const { min, max } = LIMITS.username;
  if (!username) return fail('Choose a username.');
  if (username.length < min) return fail(`Usernames must be at least ${min} characters.`);
  if (username.length > max) return fail(`Usernames must be at most ${max} characters.`);
  if (!USERNAME_REGEX.test(username)) {
    return fail('Usernames can contain lowercase letters, numbers and underscores only.');
  }
  if (RESERVED_USERNAMES.has(username)) return fail('That username is reserved by the platform.');
  if (/^_|_$/.test(username)) return fail('Usernames cannot start or end with an underscore.');
  if (/_{2,}/.test(username)) return fail('Usernames cannot contain consecutive underscores.');
  if (/^\d+$/.test(username)) return fail('Usernames cannot be only numbers.');
  return ok(username);
}

export const profileSetupSchema = {
  display_name: (v) => vString(v, { min: LIMITS.displayName.min, max: LIMITS.displayName.max, label: 'Display name', allowNewlines: false }),
  branch: (v) => vEnum(v, BRANCHES, { label: 'Branch', required: false }),
  year: (v) => vEnum(v, YEARS, { label: 'Year', required: false }),
  division: (v) => vEnum(v, DIVISIONS, { label: 'Division', required: false }),
  bio: (v) => vOptionalString(v, { max: LIMITS.bio.max, label: 'Bio' }),
  show_branch_year: (v) => vBoolean(v),
};

/**
 * First-login onboarding: the username is claimed here, so it is validated with
 * the strictest rules (format, reserved names) before `complete_profile()` runs
 * its own checks as the authority.
 */
export const onboardingSchema = {
  username: (v) => vUsername(v),
  accept_rules: (v) => (vBoolean(v).value === true ? ok(true) : fail('Please accept the community rules to continue.')),
  ...profileSetupSchema,
};

export const profileUpdateSchema = {
  display_name: (v) => vString(v, { min: LIMITS.displayName.min, max: LIMITS.displayName.max, label: 'Display name', allowNewlines: false }),
  bio: (v) => vOptionalString(v, { max: LIMITS.bio.max, label: 'Bio' }),
  branch: (v) => vEnum(v, BRANCHES, { label: 'Branch', required: false }),
  year: (v) => vEnum(v, YEARS, { label: 'Year', required: false }),
  division: (v) => vEnum(v, DIVISIONS, { label: 'Division', required: false }),
  show_branch_year: (v) => vBoolean(v),
  allow_dms_from_everyone: (v) => vBoolean(v),
};

/* -------------------------------------------------------------------------- */
/* Social                                                                      */
/* -------------------------------------------------------------------------- */

export const postSchema = {
  body: (v) => vString(v, { min: LIMITS.post.min, max: LIMITS.post.max, label: 'Post' }),
  // Standalone posts are campus-only. Community posts are separately scoped by
  // membership in RLS; retain the broader enum for existing community callers.
  visibility: (v, input) => {
    const hasCommunity = Boolean(input?.community_id);
    const allowed = hasCommunity ? ['public', 'campus', 'community'] : ['campus'];
    return vEnum(v ?? (hasCommunity ? 'community' : 'campus'), allowed, { label: 'Visibility' });
  },
  community_id: (v) => vUuid(v, { label: 'Community', required: false }),
  poll: (_v, input) => {
    const options = Array.isArray(input?.poll_options) ? input.poll_options.filter((o) => cleanText(o)) : [];
    if (!input?.is_poll) return input?.is_poll === false || input?.is_poll === undefined ? ok(null) : fail('Invalid poll flag.');
    const question = vString(input?.poll_question, {
      min: LIMITS.poll.question.min, max: LIMITS.poll.question.max, label: 'Poll question', allowNewlines: false,
    });
    if (!question.ok) return question;
    if (options.length < LIMITS.poll.minOptions) return fail(`Add at least ${LIMITS.poll.minOptions} poll options.`);
    if (options.length > LIMITS.poll.maxOptions) return fail(`A poll can have at most ${LIMITS.poll.maxOptions} options.`);
    const cleaned = [];
    for (const option of options) {
      const result = vString(option, { min: LIMITS.poll.option.min, max: LIMITS.poll.option.max, label: 'Poll option', allowNewlines: false });
      if (!result.ok) return result;
      if (cleaned.some((c) => c.toLowerCase() === result.value.toLowerCase())) return fail('Poll options must be unique.');
      cleaned.push(result.value);
    }
    return ok({ question: question.value, options: cleaned, closes_at: null });
  },
};

export const commentSchema = {
  body: (v) => vString(v, { min: LIMITS.comment.min, max: LIMITS.comment.max, label: 'Comment' }),
  parent_id: (v) => vUuid(v, { label: 'Comment', required: false }),
  gif: (v) => gifRefValidator(v),
};

export const discussionSchema = {
  title: (v) => vString(v, { min: 5, max: 140, label: 'Title', allowNewlines: false }),
  body: (v) => vString(v, { min: LIMITS.post.min, max: LIMITS.post.max, label: 'Discussion' }),
};

/* -------------------------------------------------------------------------- */
/* GIF references (only GIPHY origins are ever stored — spec §88)              */
/* -------------------------------------------------------------------------- */

export const GIPHY_HOSTS = ['giphy.com', 'media.giphy.com', 'media0.giphy.com', 'media1.giphy.com', 'media2.giphy.com', 'media3.giphy.com', 'media4.giphy.com'];

/** Validate an externally-sourced GIF reference before it is persisted. */
export function gifRefValidator(input) {
  if (input === null || input === undefined || input === '') return ok(null);
  let payload = input;
  if (typeof input === 'string') {
    try {
      payload = JSON.parse(input);
    } catch {
      return fail('That GIF reference is not valid.');
    }
  }
  if (typeof payload !== 'object' || Array.isArray(payload)) return fail('That GIF reference is not valid.');
  const provider = String(payload.provider || 'giphy');
  if (provider !== 'giphy') return fail('Only GIFs from the approved provider can be attached.');
  const id = cleanText(payload.id);
  if (!/^[A-Za-z0-9_-]{5,64}$/.test(id)) return fail('That GIF reference is not valid.');
  const url = vUrl(payload.url, { required: true, label: 'GIF URL', allowedHosts: GIPHY_HOSTS });
  if (!url.ok) return fail('That GIF reference does not come from the approved provider.');
  const preview = payload.preview ? vUrl(payload.preview, { required: true, label: 'GIF preview', allowedHosts: GIPHY_HOSTS }) : ok(null);
  if (!preview.ok) return fail('That GIF reference does not come from the approved provider.');
  const width = Number.isFinite(Number(payload.width)) ? Math.min(Math.max(Number(payload.width), 1), 2000) : null;
  const height = Number.isFinite(Number(payload.height)) ? Math.min(Math.max(Number(payload.height), 1), 2000) : null;
  const title = cleanText(payload.title).slice(0, 120) || null;
  return ok({ provider: 'giphy', id, url: url.value, preview: preview.value || url.value, width, height, title });
}

/* -------------------------------------------------------------------------- */
/* Messaging                                                                   */
/* -------------------------------------------------------------------------- */

export const messageSchema = {
  body: (v, input) => {
    const text = vOptionalString(v, { max: LIMITS.message.max, label: 'Message' });
    if (!text.ok) return text;
    const gif = gifRefValidator(input?.gif);
    if (!gif.ok) return gif;
    if (!text.value && !gif.value) return fail('Write a message or pick a GIF.');
    return ok(text.value || '');
  },
  gif: (v) => gifRefValidator(v),
};

export const conversationStartSchema = {
  target: (v) => vString(v, { min: 1, max: 64, label: 'Recipient', allowNewlines: false }),
  context_type: (v) => vEnum(v, ['marketplace_listing', 'gig', 'event', 'project', 'club', 'housing_post', 'ride_post', 'profile'], { label: 'Context', required: false }),
  context_id: (v) => vUuid(v, { label: 'Context', required: false }),
};

/* -------------------------------------------------------------------------- */
/* Marketplace                                                                 */
/* -------------------------------------------------------------------------- */

const CONDITIONS = MARKETPLACE_CONDITIONS.map((c) => c.value);

export const listingSchema = {
  title: (v) => vString(v, { min: LIMITS.listing.title.min, max: LIMITS.listing.title.max, label: 'Title', allowNewlines: false }),
  description: (v) => vString(v, { min: 5, max: LIMITS.listing.description.max, label: 'Description' }),
  price: (v, input) => {
    if (input?.is_free === true || input?.is_free === 'true') return ok(0);
    return vNumber(v, { min: 0, max: 10_000_000, label: 'Price', required: false });
  },
  is_free: (v) => vBoolean(v),
  category_id: (v) => vUuid(v, { label: 'Category' }),
  condition: (v) => vEnum(v, CONDITIONS, { label: 'Condition', required: false }),
  location: (v) => vOptionalString(v, { max: LIMITS.listing.location.max, label: 'Location', allowNewlines: false }),
  contact_note: (v) => vOptionalString(v, { max: 200, label: 'Contact note', allowNewlines: false }),
};

export const gigSchema = {
  title: (v) => vString(v, { min: LIMITS.gig.title.min, max: LIMITS.gig.title.max, label: 'Title', allowNewlines: false }),
  description: (v) => vString(v, { min: 5, max: LIMITS.gig.description.max, label: 'Description' }),
  category: (v) => vString(v, { min: 2, max: 60, label: 'Category', allowNewlines: false }),
  compensation: (v) => vOptionalString(v, { max: 120, label: 'Compensation', allowNewlines: false }),
  availability: (v) => vOptionalString(v, { max: 200, label: 'Availability', allowNewlines: false }),
};

export const dealSchema = {
  title: (v) => vString(v, { min: LIMITS.deal.title.min, max: LIMITS.deal.title.max, label: 'Title', allowNewlines: false }),
  description: (v) => vString(v, { min: 5, max: LIMITS.deal.description.max, label: 'Description' }),
  merchant: (v) => vString(v, { min: 2, max: 120, label: 'Merchant', allowNewlines: false }),
  discount_details: (v) => vString(v, { min: 2, max: 300, label: 'Discount details' }),
  valid_from: (v) => vDate(v, { label: 'Valid from' }),
  valid_until: (v) => vDate(v, { label: 'Valid until' }),
  contact_info: (v) => vOptionalString(v, { max: 200, label: 'Contact', allowNewlines: false }),
};

export const housingSchema = {
  title: (v) => vString(v, { min: LIMITS.housing.title.min, max: LIMITS.housing.title.max, label: 'Title', allowNewlines: false }),
  description: (v) => vString(v, { min: 5, max: LIMITS.housing.description.max, label: 'Description' }),
  area: (v) => vString(v, { min: 2, max: 120, label: 'Area', allowNewlines: false }),
  budget: (v) => vOptionalString(v, { max: 80, label: 'Budget', allowNewlines: false }),
  room_type: (v) => vEnum(v, ['single', 'shared', 'pg', 'flat', 'hostel', 'other'], { label: 'Room type' }),
  available_from: (v) => vDate(v, { label: 'Available from' }),
};

export const rideSchema = {
  origin: (v) => vString(v, { min: 2, max: 120, label: 'Origin', allowNewlines: false }),
  destination: (v) => vString(v, { min: 2, max: 120, label: 'Destination', allowNewlines: false }),
  ride_date: (v) => vDate(v, { label: 'Date', required: true }),
  ride_time: (v) => vTime(v, { label: 'Time' }),
  description: (v) => vString(v, { min: 5, max: LIMITS.ride.description.max, label: 'Description' }),
  seats: (v) => vNumber(v, { min: 1, max: 10, label: 'Seats', integer: true, required: false }),
};

export const ratingSchema = {
  target_ref: (v) => vString(v, { min: 1, max: 64, label: 'User', allowNewlines: false }),
  listing_id: (v) => vUuid(v, { label: 'Listing' }),
  score: (v) => vNumber(v, { min: 1, max: 5, label: 'Rating', integer: true }),
  comment: (v) => vOptionalString(v, { max: 300, label: 'Comment' }),
};

/* -------------------------------------------------------------------------- */
/* Campus                                                                      */
/* -------------------------------------------------------------------------- */

export const eventSchema = {
  title: (v) => vString(v, { min: LIMITS.event.title.min, max: LIMITS.event.title.max, label: 'Title', allowNewlines: false }),
  description: (v) => vString(v, { min: 5, max: LIMITS.event.description.max, label: 'Description' }),
  starts_on: (v) => vDate(v, { label: 'Start date', required: true, allowPast: false }),
  ends_on: (v) => vDate(v, { label: 'End date' }),
  start_time: (v) => vTime(v, { label: 'Start time' }),
  end_time: (v) => vTime(v, { label: 'End time' }),
  location: (v) => vString(v, { min: 2, max: LIMITS.event.location.max, label: 'Location', allowNewlines: false }),
  organizer: (v) => vOptionalString(v, { max: 120, label: 'Organizer', allowNewlines: false }),
  registration_info: (v) => vOptionalString(v, { max: 500, label: 'Registration info' }),
  registration_url: (v) => vUrl(v, { label: 'Registration link' }),
  club_id: (v) => vUuid(v, { label: 'Club', required: false }),
  show_attendees: (v) => vBoolean(v),
  capacity: (v) => vNumber(v, { min: 1, max: 100_000, label: 'Capacity', integer: true, required: false }),
  category: (v) => vEnum(v, EVENT_CATEGORIES.map((c) => c.value), { label: 'Category', required: false }),
  status: (v) => vEnum(v ?? 'published', EVENT_STATUS, { label: 'Status' }),
};

export const clubSchema = {
  name: (v) => vString(v, { min: LIMITS.club.name.min, max: LIMITS.club.name.max, label: 'Name', allowNewlines: false }),
  description: (v) => vString(v, { min: 10, max: LIMITS.club.description.max, label: 'Description' }),
  recruitment_info: (v) => vOptionalString(v, { max: 1000, label: 'Recruitment info' }),
  contact_info: (v) => vOptionalString(v, { max: 200, label: 'Contact', allowNewlines: false }),
  external_url: (v) => vUrl(v, { label: 'Website' }),
};

export const noticeSchema = {
  title: (v) => vString(v, { min: LIMITS.notice.title.min, max: LIMITS.notice.title.max, label: 'Title', allowNewlines: false }),
  body: (v) => vString(v, { min: 5, max: LIMITS.notice.body.max, label: 'Notice' }),
  category: (v) => vEnum(v, NOTICE_CATEGORIES.map((c) => c.value), { label: 'Category' }),
  importance: (v) => vEnum(v ?? 'normal', ['low', 'normal', 'high', 'critical'], { label: 'Importance' }),
  expires_at: (v) => vDate(v, { label: 'Expiry' }),
  pinned: (v) => vBoolean(v),
  status: (v) => vEnum(v ?? 'published', ['draft', 'published', 'archived'], { label: 'Status' }),
};

export const communitySchema = {
  name: (v) => vString(v, { min: LIMITS.community.name.min, max: LIMITS.community.name.max, label: 'Name', allowNewlines: false }),
  slug: (v) => vOptionalString(v, { max: 60, label: 'Link', allowNewlines: false }),
  description: (v) => vString(v, { min: 10, max: LIMITS.community.description.max, label: 'Description' }),
  subject: (v) => vOptionalString(v, { max: 120, label: 'Subject', allowNewlines: false }),
  branch: (v) => vEnum(v, BRANCHES, { label: 'Branch', required: false }),
  year: (v) => vEnum(v, YEARS, { label: 'Year', required: false }),
  meeting_info: (v) => vOptionalString(v, { max: 200, label: 'Meeting info', allowNewlines: false }),
  contact_info: (v) => vOptionalString(v, { max: 200, label: 'Contact', allowNewlines: false }),
  external_url: (v) => vUrl(v, { label: 'Website', required: false }),
  visibility: (v) => vEnum(v ?? 'public', ['public', 'campus', 'private'], { label: 'Visibility' }),
  join_policy: (v) => vEnum(v ?? 'open', ['open', 'request', 'invite'], { label: 'Join policy' }),
};

export const studyGroupSchema = {
  name: (v) => vString(v, { min: LIMITS.studyGroup.name.min, max: LIMITS.studyGroup.name.max, label: 'Name', allowNewlines: false }),
  slug: (v) => vOptionalString(v, { max: 60, label: 'Link', allowNewlines: false }),
  description: (v) => vString(v, { min: 10, max: LIMITS.studyGroup.description.max, label: 'Description' }),
  subject: (v) => vString(v, { min: 2, max: 120, label: 'Subject', allowNewlines: false }),
  branch: (v) => vEnum(v, BRANCHES, { label: 'Branch', required: false }),
  year: (v) => vEnum(v, YEARS, { label: 'Year', required: false }),
  meeting_info: (v) => vOptionalString(v, { max: 200, label: 'Meeting info', allowNewlines: false }),
  // Study groups are always member-only (the action forces this before
  // validation runs) — validated here too so `checked.data.visibility` is
  // never silently dropped and the insert cannot fall back to 'campus'.
  visibility: (v) => vEnum(v ?? 'community', ['community'], { label: 'Visibility' }),
  join_policy: (v) => vEnum(v ?? 'open', ['open', 'request', 'invite'], { label: 'Join policy' }),
};

export const lostFoundSchema = {
  kind: (v) => vEnum(v, ['lost', 'found'], { label: 'Report type' }),
  title: (v) => vString(v, { min: LIMITS.lostFound.title.min, max: LIMITS.lostFound.title.max, label: 'Title', allowNewlines: false }),
  description: (v) => vString(v, { min: 5, max: LIMITS.lostFound.description.max, label: 'Description' }),
  location: (v) => vOptionalString(v, { max: 120, label: 'Approximate location', allowNewlines: false }),
  occurred_on: (v) => vDate(v, { label: 'Date' }),
};

export const resourceSchema = {
  title: (v) => vString(v, { min: LIMITS.resource.title.min, max: LIMITS.resource.title.max, label: 'Title', allowNewlines: false }),
  description: (v) => vString(v, { min: 10, max: LIMITS.resource.description.max, label: 'Description' }),
  url: (v) => vUrl(v, { required: true, label: 'Resource link' }),
  branch: (v) => vEnum(v, BRANCHES, { label: 'Branch', required: false }),
  year: (v) => vEnum(v, YEARS, { label: 'Year', required: false }),
  semester: (v) => vEnum(v, SEMESTERS, { label: 'Semester', required: false }),
  subject: (v) => vOptionalString(v, { max: 120, label: 'Subject', allowNewlines: false }),
  type: (v) => vEnum(v, RESOURCE_TYPES.map((t) => t.value), { label: 'Type' }),
};

export const opportunitySchema = {
  title: (v) => vString(v, { min: LIMITS.opportunity.title.min, max: LIMITS.opportunity.title.max, label: 'Title', allowNewlines: false }),
  organization: (v) => vString(v, { min: 2, max: 140, label: 'Organization', allowNewlines: false }),
  description: (v) => vString(v, { min: 10, max: LIMITS.opportunity.description.max, label: 'Description' }),
  eligibility: (v) => vOptionalString(v, { max: 500, label: 'Eligibility' }),
  deadline: (v) => vDate(v, { label: 'Deadline' }),
  url: (v) => vUrl(v, { label: 'More information link' }),
  location: (v) => vOptionalString(v, { max: 120, label: 'Location', allowNewlines: false }),
  mode: (v) => vEnum(v ?? 'onsite', ['onsite', 'remote', 'hybrid'], { label: 'Mode' }),
  category: (v) => vEnum(v, OPPORTUNITY_CATEGORIES.map((c) => c.value), { label: 'Category', required: false }),
};

export const projectSchema = {
  title: (v) => vString(v, { min: LIMITS.project.title.min, max: LIMITS.project.title.max, label: 'Title', allowNewlines: false }),
  description: (v) => vString(v, { min: 10, max: LIMITS.project.description.max, label: 'Description' }),
  technologies: (v) => vString(v, { min: 1, max: 300, label: 'Technologies', allowNewlines: false }),
  repo_url: (v) => vUrl(v, { label: 'Repository link', allowedHosts: ['github.com', 'gitlab.com', 'bitbucket.org'] }),
  live_url: (v) => vUrl(v, { label: 'Live link' }),
  team_members: (v) => vOptionalString(v, { max: 300, label: 'Team members', allowNewlines: false }),
};

export const teamPostSchema = {
  project_name: (v) => vString(v, { min: 3, max: 140, label: 'Project or hackathon', allowNewlines: false }),
  description: (v) => vString(v, { min: 10, max: 1500, label: 'Description' }),
  required_skills: (v) => vString(v, { min: 2, max: 300, label: 'Required skills', allowNewlines: false }),
  team_size: (v) => vNumber(v, { min: 1, max: 50, label: 'Team size', integer: true, required: false }),
  deadline: (v) => vDate(v, { label: 'Deadline' }),
};

/**
 * Study partner requests. Coarse availability categories only — the schema
 * accepts nothing more precise, so detailed schedules cannot be stored even
 * by a forged request.
 */
export function vAvailability(input) {
  const allowed = STUDY_AVAILABILITY.map((slot) => slot.value);
  const list = Array.isArray(input) ? input : (input === null || input === undefined || input === '' ? [] : [input]);
  if (list.length > allowed.length) return fail('Availability has too many entries.');
  const seen = new Set();
  for (const entry of list) {
    const value = String(entry);
    if (!allowed.includes(value)) return fail('Availability is not one of the allowed options.');
    if (seen.has(value)) return fail('Availability contains a duplicate entry.');
    seen.add(value);
  }
  return ok([...seen]);
}

export const studyPostSchema = {
  title: (v) => vString(v, { min: LIMITS.studyPost.title.min, max: LIMITS.studyPost.title.max, label: 'Title', allowNewlines: false }),
  description: (v) => vString(v, { min: LIMITS.studyPost.description.min, max: LIMITS.studyPost.description.max, label: 'Description' }),
  subject: (v) => vString(v, { min: LIMITS.studyPost.subject.min, max: LIMITS.studyPost.subject.max, label: 'Subject', allowNewlines: false }),
  purpose: (v) => vEnum(v, STUDY_PURPOSES.map((p) => p.value), { label: 'Purpose' }),
  branch: (v) => vEnum(v, BRANCHES, { label: 'Branch', required: false }),
  year: (v) => vEnum(v, YEARS, { label: 'Year', required: false }),
  academic_context: (v) => vOptionalString(v, { max: LIMITS.studyPost.context.max, label: 'Academic context', allowNewlines: false }),
  mode: (v) => vEnum(v ?? 'either', STUDY_MODES.map((m) => m.value), { label: 'Collaboration mode' }),
  availability: (v) => vAvailability(v),
  expires_on: (v) => vDate(v, { label: 'Closing date', allowPast: false }),
};

export const campusContentSchema = {
  title: (v) => vString(v, { min: LIMITS.campusContent.title.min, max: LIMITS.campusContent.title.max, label: 'Title', allowNewlines: false }),
  body: (v) => vOptionalString(v, { max: LIMITS.campusContent.body.max, label: 'Details' }),
  description: (v) => vOptionalString(v, { max: LIMITS.campusContent.body.max, label: 'Description' }),
  location: (v) => vOptionalString(v, { max: 200, label: 'Location', allowNewlines: false }),
  contact_info: (v) => vOptionalString(v, { max: 300, label: 'Contact information', allowNewlines: false }),
  external_url: (v) => vUrl(v, { label: 'External link' }),
  category: (v) => vOptionalString(v, { max: 80, label: 'Category', allowNewlines: false }),
  url: (v) => vUrl(v, { label: 'Link' }),
  starts_on: (v) => vDate(v, { label: 'Start date' }),
  ends_on: (v) => vDate(v, { label: 'End date' }),
  deadline: (v) => vDate(v, { label: 'Deadline' }),
  valid_from: (v) => vDate(v, { label: 'Valid from' }),
  valid_until: (v) => vDate(v, { label: 'Valid until' }),
};

/* -------------------------------------------------------------------------- */
/* Safety & system                                                             */
/* -------------------------------------------------------------------------- */

export const reportSchema = {
  target_type: (v) => vEnum(v, REPORT_TARGET_TYPES, { label: 'Report type' }),
  target_ref: (v) => vString(v, { min: 1, max: 64, label: 'Reported item', allowNewlines: false }),
  reason: (v) => vEnum(v, REPORT_REASONS.map((r) => r.value), { label: 'Reason' }),
  details: (v) => vOptionalString(v, { max: LIMITS.report.details.max, label: 'Details' }),
  session_id: (v) => vUuid(v, { label: 'Session', required: false }),
};

export const moderationActionSchema = {
  action: (v) => vEnum(v, MODERATION_ACTIONS, { label: 'Action' }),
  note: (v) => vOptionalString(v, { max: LIMITS.moderationNote.max, label: 'Note' }),
  duration_days: (v) => vNumber(v, { min: 0, max: 3650, label: 'Duration', integer: true, required: false }),
};

export const notificationSchema = {
  type: (v) => vEnum(v, NOTIFICATION_TYPES, { label: 'Notification type' }),
  title: (v) => vString(v, { min: 1, max: 140, label: 'Title', allowNewlines: false }),
  body: (v) => vOptionalString(v, { max: 500, label: 'Body' }),
  reference_type: (v) => vOptionalString(v, { max: 60, label: 'Reference type', allowNewlines: false }),
  reference_id: (v) => vOptionalString(v, { max: 80, label: 'Reference', allowNewlines: false }),
  url: (v) => vOptionalString(v, { max: 300, label: 'Link', allowNewlines: false }),
};

export const reportResolutionSchema = {
  status: (v) => vEnum(v, REPORT_STATUS, { label: 'Status' }),
  resolution: (v) => vOptionalString(v, { max: 1000, label: 'Resolution' }),
};

export const listingModerationSchema = {
  status: (v) => vEnum(v, LISTING_STATUS, { label: 'Listing status' }),
  reason: (v) => vOptionalString(v, { max: 500, label: 'Reason' }),
};

export const contentStatusSchema = {
  status: (v) => vEnum(v, CONTENT_STATUS, { label: 'Status' }),
  reason: (v) => vOptionalString(v, { max: 500, label: 'Reason' }),
};

export const visibilitySchema = {
  visibility: (v) => vEnum(v, VISIBILITY, { label: 'Visibility' }),
};

export const accountStatusSchema = {
  status: (v) => vEnum(v, ACCOUNT_STATUS, { label: 'Account status' }),
  duration_days: (v) => vNumber(v, { min: 0, max: 3650, label: 'Duration', integer: true, required: false }),
  reason: (v) => vOptionalString(v, { max: 500, label: 'Reason' }),
};

export const rsvpSchema = {
  status: (v) => vEnum(v, RSVP_STATUS, { label: 'RSVP status' }),
};

export const platformSettingSchema = {
  key: (v) => vString(v, { min: 1, max: 80, label: 'Setting key', allowNewlines: false }),
  value: (v) => {
    if (v === undefined) return fail('Setting value is required.');
    return ok(v);
  },
};

export const featureFlagSchema = {
  key: (v) => vString(v, { min: 1, max: 80, label: 'Flag key', allowNewlines: false }),
  enabled: (v) => vBoolean(v),
};

export const searchQuerySchema = {
  q: (v) => {
    const result = vString(v, { min: 1, max: 80, label: 'Search', allowNewlines: false });
    if (!result.ok) return result;
    if (result.value.length < 2) return fail('Type at least 2 characters to search.');
    return ok(result.value);
  },
  scope: (v) => vEnum(v ?? 'all', ['all', 'people', 'posts', 'communities', 'marketplace', 'events', 'clubs', 'resources', 'opportunities', 'projects', 'discussions', 'study'], { label: 'Scope' }),
};

export const roleAssignmentSchema = {
  user_ref: (v) => vString(v, { min: 1, max: 64, label: 'User', allowNewlines: false }),
  role: (v) => vString(v, { min: 1, max: 60, label: 'Role', allowNewlines: false }),
};

export const roleDefinitionSchema = {
  key: (v) => vString(v, { min: 2, max: 40, label: 'Role key', allowNewlines: false }),
  label: (v) => vString(v, { min: 2, max: 60, label: 'Role label', allowNewlines: false }),
  description: (v) => vOptionalString(v, { max: 300, label: 'Description' }),
  rank: (v) => vNumber(v, { min: 0, max: 1000, label: 'Rank', integer: true }),
};

export const permissionAssignmentSchema = {
  role: (v) => vString(v, { min: 1, max: 60, label: 'Role', allowNewlines: false }),
  permissions: (v) => vArrayOf(v, (item) => vString(item, { min: 1, max: 60, label: 'Permission', allowNewlines: false }), { max: 200, label: 'Permissions' }),
};

export const broadcastSchema = {
  scope: (v) => vEnum(v, ['all', 'students', 'moderators', 'admins'], { label: 'Audience' }),
  title: (v) => vString(v, { min: 3, max: 140, label: 'Title', allowNewlines: false }),
  body: (v) => vString(v, { min: 3, max: 1000, label: 'Message' }),
  url: (v) => vOptionalString(v, { max: 300, label: 'Link', allowNewlines: false }),
};

export const officialSourceSchema = {
  kind: (v) => vEnum(v ?? SOURCE_KIND.community, [SOURCE_KIND.official, SOURCE_KIND.community], { label: 'Source' }),
};

export { ok, fail };
