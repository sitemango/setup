/**
 * Campus+ — central configuration.
 *
 * Every shared limit, enum and controlled vocabulary lives here so components,
 * server actions and database defaults never drift apart. Values whose operative
 * enforcement lives in the database (e.g. text lengths) are documented next to
 * the SQL that mirrors them (see database/migrations/100_platform_settings.sql).
 *
 * @see docs/ARCHITECTURE.md
 */

/* -------------------------------------------------------------------------- */
/* Platform                                                                    */
/* -------------------------------------------------------------------------- */

export const PLATFORM = {
  name: process.env.NEXT_PUBLIC_PLATFORM_NAME || 'Campus+',
  collegeName: process.env.NEXT_PUBLIC_COLLEGE_NAME || 'PCCOE',
  tagline: 'An unofficial digital layer for campus life.',
};

/** Institutional domains. Server-side env override, database is the authority. */
export const DEFAULT_ALLOWED_EMAIL_DOMAINS = (
  process.env.CAMPUS_ALLOWED_EMAIL_DOMAINS || 'pccoepune.org'
)
  .split(',')
  .map((d) => d.trim().toLowerCase())
  .filter(Boolean);

/* -------------------------------------------------------------------------- */
/* Text limits (mirrored by CHECK constraints in migration 100)                */
/* -------------------------------------------------------------------------- */

export const LIMITS = {
  username: { min: 3, max: 24 },
  displayName: { min: 2, max: 60 },
  bio: { max: 280 },

  post: { min: 1, max: 2000 },
  comment: { min: 1, max: 1000 },
  message: { min: 1, max: 2000 },
  mentionNote: { max: 500 },

  community: { name: { min: 3, max: 60 }, description: { max: 500 } },
  club: { name: { min: 3, max: 80 }, description: { max: 1000 } },
  studyGroup: { name: { min: 3, max: 80 }, description: { max: 600 } },

  listing: {
    title: { min: 3, max: 120 },
    description: { max: 1500 },
    location: { max: 120 },
  },
  gig: { title: { min: 3, max: 120 }, description: { max: 1500 } },
  deal: { title: { min: 3, max: 120 }, description: { max: 1000 } },

  event: { title: { min: 3, max: 140 }, description: { max: 2000 }, location: { max: 140 } },
  notice: { title: { min: 3, max: 140 }, body: { max: 4000 } },

  resource: { title: { min: 3, max: 140 }, description: { max: 1000 } },
  opportunity: { title: { min: 3, max: 140 }, description: { max: 2000 } },
  project: { title: { min: 3, max: 140 }, description: { max: 2000 } },

  lostFound: { title: { min: 3, max: 140 }, description: { max: 1000 } },
  housing: { title: { min: 3, max: 140 }, description: { max: 1000 } },
  ride: { description: { max: 800 } },

  poll: { question: { min: 5, max: 240 }, option: { min: 1, max: 120 }, minOptions: 2, maxOptions: 10 },

  studyPost: {
    title: { min: 3, max: 140 },
    description: { min: 10, max: 1500 },
    subject: { min: 2, max: 120 },
    context: { max: 200 },
  },

  report: { details: { max: 1000 } },
  moderationNote: { max: 1000 },

  campusContent: { title: { min: 3, max: 140 }, body: { max: 4000 } },
};

/** Query / pagination limits — the UI never loads a whole table. */
export const PAGE_SIZE = {
  default: 20,
  feed: 20,
  comments: 30,
  messages: 40,
  notifications: 30,
  search: 20,
  admin: 50,
  max: 100,
};

/* -------------------------------------------------------------------------- */
/* Username                                                                    */
/* -------------------------------------------------------------------------- */

export const USERNAME_REGEX = /^[a-z0-9_]{3,24}$/;

/** Names that cannot be claimed: platform identity, roles and reserved paths. */
export const RESERVED_USERNAMES = new Set([
  'admin', 'administrator', 'superadmin', 'super_admin', 'moderator', 'mod', 'staff',
  'root', 'system', 'support', 'help', 'campus', 'campusplus', 'campus_plus', 'official',
  'pccoe', 'college', 'security', 'billing', 'null', 'undefined', 'anonymous', 'anon',
  'you', 'me', 'everyone', 'here', 'random', 'bot', 'api', 'www', 'mail', 'smtp',
  'login', 'signup', 'signin', 'logout', 'register', 'settings', 'account', 'profile',
  'home', 'explore', 'market', 'communities', 'chat', 'admin_panel', 'moderator_panel',
]);

/* -------------------------------------------------------------------------- */
/* Roles & permissions                                                         */
/* -------------------------------------------------------------------------- */

export const ROLES = {
  student: 'student',
  moderator: 'moderator',
  admin: 'admin',
  super_admin: 'super_admin',
};

export const ROLE_ORDER = ['student', 'moderator', 'admin', 'super_admin'];

export const ROLE_LABELS = {
  student: 'Student',
  moderator: 'Moderator',
  admin: 'Admin',
  super_admin: 'Super Admin',
};

/**
 * The permission catalogue. This is the single source of truth for the
 * *shape* of authorization; the database owns the *assignment*
 * (roles → role_permissions → user_roles). Seeded into migration 002 and kept
 * in sync by migration 100's `sync_permission_catalog()`.
 */
export const PERMISSIONS = [
  // --- student baseline -----------------------------------------------------
  { key: 'submit_confessions', label: 'Submit confessions', group: 'Social', description: 'Submit anonymous confessions within the daily quota.' },
  { key: 'create_posts', label: 'Create posts', group: 'Social', description: 'Publish text posts and discussions.' },
  { key: 'create_comments', label: 'Create comments', group: 'Social', description: 'Comment on posts and listings.' },
  { key: 'react_content', label: 'React to content', group: 'Social', description: 'React to posts, comments and replies.' },
  { key: 'create_polls', label: 'Create polls', group: 'Social', description: 'Publish text polls.' },
  { key: 'send_messages', label: 'Send messages', group: 'Messaging', description: 'Start and reply to direct conversations.' },
  { key: 'use_random_chat', label: 'Use Random', group: 'Messaging', description: 'Join the anonymous Random queue.' },
  { key: 'use_gifs', label: 'Use GIFs', group: 'Content', description: 'Attach GIPHY GIFs to allowed surfaces.' },
  { key: 'create_communities', label: 'Create communities', group: 'Communities', description: 'Create communities, study groups and clubs.' },
  { key: 'create_marketplace_listing', label: 'Create marketplace listings', group: 'Marketplace', description: 'Publish listings, gigs and free items.' },
  { key: 'create_gigs', label: 'Create gigs', group: 'Marketplace', description: 'Publish student service gigs.' },
  { key: 'create_housing_post', label: 'Create housing posts', group: 'Marketplace', description: 'Publish roommate/housing posts.' },
  { key: 'create_ride_post', label: 'Create ride posts', group: 'Marketplace', description: 'Publish ride/carpool posts.' },
  { key: 'submit_resources', label: 'Submit resources', group: 'Campus', description: 'Submit academic resource links and notes.' },
  { key: 'submit_opportunities', label: 'Submit opportunities', group: 'Campus', description: 'Submit community opportunities (clearly marked as community-submitted).' },
  { key: 'create_projects', label: 'Create projects', group: 'Campus', description: 'Publish project showcase entries.' },
  { key: 'create_lost_found', label: 'Create lost & found posts', group: 'Campus', description: 'Report lost or found items.' },
  { key: 'create_team_posts', label: 'Create team posts', group: 'Campus', description: 'Post team-finder requests.' },
  { key: 'create_study_posts', label: 'Create study partner posts', group: 'Campus', description: 'Publish opt-in study partner requests.' },
  { key: 'submit_events', label: 'Submit events', group: 'Campus', description: 'Submit community events for staff review (never published as official).' },
  { key: 'rsvp_events', label: 'RSVP to events', group: 'Campus', description: 'Register for campus events.' },
  { key: 'join_clubs', label: 'Join clubs', group: 'Campus', description: 'Join club pages.' },
  { key: 'report_content', label: 'Report content', group: 'Safety', description: 'Report users and content for review.' },
  { key: 'block_users', label: 'Block users', group: 'Safety', description: 'Block other students.' },
  { key: 'rate_users', label: 'Rate marketplace interactions', group: 'Marketplace', description: 'Leave buyer/seller ratings.' },
  { key: 'manage_own_profile', label: 'Manage own profile', group: 'Account', description: 'Edit profile, username and settings.' },
  { key: 'manage_own_content', label: 'Manage own content', group: 'Account', description: 'Edit or delete content they authored.' },

  // --- moderator ------------------------------------------------------------
  { key: 'moderate_confessions', label: 'Moderate confessions', group: 'Moderation', description: 'Review confession content without author identity.' },
  { key: 'review_reports', label: 'Review reports', group: 'Moderation', description: 'Open and triage the report queue.' },
  { key: 'remove_posts', label: 'Moderate posts', group: 'Moderation', description: 'Hide or remove posts and discussions.' },
  { key: 'remove_comments', label: 'Moderate comments', group: 'Moderation', description: 'Hide or remove comments.' },
  { key: 'moderate_marketplace', label: 'Moderate marketplace', group: 'Moderation', description: 'Hide, remove or flag marketplace listings and gigs.' },
  { key: 'moderate_communities', label: 'Moderate communities', group: 'Moderation', description: 'Moderate community content and membership.' },
  { key: 'moderate_random', label: 'Moderate Random reports', group: 'Moderation', description: 'Review reported anonymous sessions.' },
  { key: 'view_random_sessions', label: 'View Random session identities', group: 'Moderation', description: 'Sensitive: unmask participants of a reported Random session. Every access is audited.' },
  { key: 'suspend_users', label: 'Suspend users', group: 'Moderation', description: 'Temporarily suspend or ban accounts.' },
  { key: 'warn_users', label: 'Warn users', group: 'Moderation', description: 'Issue recorded warnings.' },
  { key: 'create_moderation_notes', label: 'Create moderation notes', group: 'Moderation', description: 'Attach internal notes to reports and users.' },
  { key: 'manage_events', label: 'Manage official events', group: 'Official Content', description: 'Create, edit and publish official campus events.' },
  { key: 'manage_notices', label: 'Manage noticeboard', group: 'Official Content', description: 'Publish and edit official notices.' },
  { key: 'manage_official_content', label: 'Manage official campus content', group: 'Official Content', description: 'Directory, services, calendar, transport, cafeteria, forms, help hub, locations.' },
  { key: 'manage_clubs', label: 'Manage clubs', group: 'Official Content', description: 'Create and configure club pages.' },
  { key: 'manage_deals', label: 'Manage campus deals', group: 'Official Content', description: 'Publish official campus deals.' },
  { key: 'view_moderation_logs', label: 'View moderation history', group: 'Moderation', description: 'Read moderation actions and their outcomes.' },
  { key: 'approve_marketplace', label: 'Approve marketplace listings', group: 'Moderation', description: 'Approve listings when pre-publication moderation is enabled.' },

  // --- admin ----------------------------------------------------------------
  { key: 'reveal_confession_identity', label: 'Reveal confession identity', group: 'Administration', description: 'Sensitive, reason-required and audited safety access.' },
  { key: 'manage_users', label: 'Manage users', group: 'Administration', description: 'Inspect and manage student accounts.' },
  { key: 'manage_roles', label: 'Manage roles', group: 'Administration', description: 'Create roles and change role definitions.' },
  { key: 'manage_permissions', label: 'Manage permissions', group: 'Administration', description: 'Assign permissions to roles.' },
  { key: 'assign_roles', label: 'Assign roles to users', group: 'Administration', description: 'Grant or revoke moderator/admin roles.' },
  { key: 'manage_categories', label: 'Manage categories', group: 'Administration', description: 'Edit marketplace and content categories.' },
  { key: 'manage_platform_settings', label: 'Manage platform settings', group: 'Administration', description: 'Change platform-wide configuration values.' },
  { key: 'manage_feature_flags', label: 'Manage feature flags', group: 'Administration', description: 'Enable or disable product modules.' },
  { key: 'view_audit_logs', label: 'View audit logs', group: 'Administration', description: 'Read the administrative audit trail.' },
  { key: 'moderate_all', label: 'Full moderation authority', group: 'Administration', description: 'Act on any content regardless of module.' },

  // --- super admin ----------------------------------------------------------
  { key: 'manage_colleges', label: 'Manage colleges', group: 'Platform', description: 'Configure institutions and their email domains.' },
  { key: 'manage_role_authority', label: 'Configure role authority', group: 'Platform', description: 'Grant administrative permissions to other roles.' },
  { key: 'view_admin_overview', label: 'View admin overview', group: 'Platform', description: 'Read operational counters in the admin dashboard.' },
];

export const PERMISSION_KEYS = PERMISSIONS.map((p) => p.key);
export const PERMISSION_KEY_SET = new Set(PERMISSION_KEYS);
export const PERMISSION_GROUPS = [...new Set(PERMISSIONS.map((p) => p.group))];

/**
 * Permissions held by the baseline Student role. Kept explicit (not "all of
 * group Social") so a future role can be composed without surprises.
 */
export const DEFAULT_STUDENT_PERMISSIONS = [
  'submit_confessions', 'create_posts', 'create_comments', 'react_content', 'create_polls',
  'send_messages', 'use_random_chat', 'use_gifs',
  'create_communities', 'create_marketplace_listing', 'create_gigs',
  'create_housing_post', 'create_ride_post',
  'submit_resources', 'submit_opportunities', 'create_projects',
  'create_lost_found', 'create_team_posts', 'create_study_posts', 'submit_events',
  'rsvp_events', 'join_clubs',
  'report_content', 'block_users', 'rate_users',
  'manage_own_profile', 'manage_own_content',
];

export const DEFAULT_MODERATOR_PERMISSIONS = [
  ...DEFAULT_STUDENT_PERMISSIONS,
  'moderate_confessions', 'review_reports', 'remove_posts', 'remove_comments', 'moderate_marketplace',
  'moderate_communities', 'moderate_random', 'suspend_users', 'warn_users',
  'create_moderation_notes', 'manage_events', 'manage_notices',
  'view_moderation_logs', 'approve_marketplace',
];

export const DEFAULT_ADMIN_PERMISSIONS = [
  ...DEFAULT_MODERATOR_PERMISSIONS,
  'reveal_confession_identity', 'view_random_sessions', 'manage_official_content', 'manage_clubs', 'manage_deals',
  'manage_users', 'manage_roles', 'manage_permissions', 'assign_roles',
  'manage_categories', 'manage_platform_settings', 'manage_feature_flags',
  'view_audit_logs', 'moderate_all', 'view_admin_overview',
];

export const DEFAULT_SUPER_ADMIN_PERMISSIONS = [
  ...DEFAULT_ADMIN_PERMISSIONS,
  'manage_colleges', 'manage_role_authority',
];

/* -------------------------------------------------------------------------- */
/* Controlled vocabularies                                                     */
/* -------------------------------------------------------------------------- */

export const ACCOUNT_STATUS = ['active', 'suspended', 'banned', 'deactivated', 'deleted', 'pending'];

export const CONTENT_STATUS = ['published', 'hidden', 'removed', 'pending', 'draft', 'archived', 'deleted'];

export const VISIBILITY = ['public', 'campus', 'community', 'private'];

export const REPORT_STATUS = ['pending', 'reviewing', 'resolved', 'dismissed'];

export const REPORT_TARGET_TYPES = [
  'user', 'post', 'comment', 'message', 'conversation', 'community',
  'marketplace_listing', 'gig', 'deal', 'event', 'club', 'resource',
  'opportunity', 'project', 'lost_found', 'housing_post', 'ride_post',
  'random_session', 'confession', 'poll',
];

export const REPORT_REASONS = [
  { value: 'spam', label: 'Spam or advertising' },
  { value: 'harassment', label: 'Harassment or bullying' },
  { value: 'hate', label: 'Hate speech' },
  { value: 'nudity', label: 'Sexual or nude content' },
  { value: 'violence', label: 'Violence or threats' },
  { value: 'scam', label: 'Scam or fraud' },
  { value: 'misinformation', label: 'Misinformation' },
  { value: 'impersonation', label: 'Impersonation' },
  { value: 'academic_dishonesty', label: 'Academic dishonesty' },
  { value: 'privacy', label: 'Privacy violation' },
  { value: 'other', label: 'Something else' },
];

export const MODERATION_ACTIONS = [
  'dismiss_report', 'note', 'warn', 'hide_content', 'remove_content',
  'restore_content', 'approve_content', 'suspend_user', 'unsuspend_user',
  'ban_user', 'unban_user', 'resolve_report', 'reassign_report',
  'lock_thread', 'unlock_thread', 'remove_message', 'end_random_session',
];

export const MODERATION_TARGET_TYPES = [
  'post', 'comment', 'marketplace_listing', 'gig', 'community', 'club',
  'project', 'lost_found', 'housing_post', 'ride_post',
];

/** Verbs understood by `moderate_content()` / `resolve_report()`. */
export const MODERATION_VERBS = ['hide', 'remove', 'restore', 'approve', 'reject'];

export const NOTIFICATION_TYPES = [
  'dm_new', 'mention', 'comment', 'reply', 'reaction',
  'marketplace_message', 'marketplace_status', 'marketplace_rating',
  'event_update', 'event_reminder', 'community_activity', 'club_activity',
  'moderation_notice', 'report_result', 'system',
];

export const MARKETPLACE_CONDITIONS = [
  { value: 'new', label: 'New' },
  { value: 'like_new', label: 'Like new' },
  { value: 'good', label: 'Good' },
  { value: 'fair', label: 'Fair' },
  { value: 'used', label: 'Used' },
  { value: 'for_parts', label: 'For parts' },
  { value: 'not_applicable', label: 'Not applicable' },
];

export const LISTING_STATUS = ['pending', 'active', 'reserved', 'sold', 'hidden', 'removed', 'rejected', 'expired'];

export const NOTICE_CATEGORIES = [
  { value: 'important', label: 'Important' },
  { value: 'academic', label: 'Academic' },
  { value: 'event', label: 'Event' },
  { value: 'opportunity', label: 'Opportunity' },
  { value: 'general', label: 'General' },
];

export const SOURCE_KIND = {
  official: 'official',
  community: 'community',
};

export const BRANCHES = [
  'Computer Engineering',
  'Information Technology',
  'Electronics & Telecommunication',
  'Mechanical Engineering',
  'Civil Engineering',
  'Artificial Intelligence & Data Science',
  'Electrical Engineering',
  'Other',
];

export const YEARS = ['First Year', 'Second Year', 'Third Year', 'Final Year'];

export const DIVISIONS = ['A', 'B', 'C', 'D', 'E', 'Not applicable'];

export const RESOURCE_TYPES = [
  { value: 'notes', label: 'Notes' },
  { value: 'reference', label: 'Reference / textbook link' },
  { value: 'video', label: 'Video lectures (external)' },
  { value: 'paper', label: 'Previous papers' },
  { value: 'tool', label: 'Tool / practice site' },
  { value: 'other', label: 'Other' },
];

export const SEMESTERS = ['1', '2', '3', '4', '5', '6', '7', '8'];

/* Study Partner Finder: explicit opt-in requests, coarse availability only. No
 * personal calendars, exact schedules, locations or presence — ever. */
export const STUDY_PURPOSES = [
  { value: 'subject_study', label: 'Subject study' },
  { value: 'exam_prep', label: 'Exam preparation' },
  { value: 'collaboration', label: 'Academic / project collaboration' },
];

export const STUDY_MODES = [
  { value: 'oncampus', label: 'On-campus' },
  { value: 'online', label: 'Online' },
  { value: 'either', label: 'Either' },
];

export const STUDY_AVAILABILITY = [
  { value: 'weekday_morning', label: 'Weekday mornings' },
  { value: 'weekday_afternoon', label: 'Weekday afternoons' },
  { value: 'weekday_evening', label: 'Weekday evenings' },
  { value: 'weekend', label: 'Weekends' },
  { value: 'flexible', label: 'Flexible' },
];

/* Campus activity calendar: additive event categories (column is nullable). */
export const EVENT_CATEGORIES = [
  { value: 'academic', label: 'Academic' },
  { value: 'cultural', label: 'Cultural' },
  { value: 'sports', label: 'Sports' },
  { value: 'technical', label: 'Technical' },
  { value: 'workshop', label: 'Workshop' },
  { value: 'club', label: 'Club activity' },
  { value: 'placement', label: 'Placements & careers' },
  { value: 'other', label: 'Other' },
];

/* Opportunity board: discovery categories (column is nullable). Team formation,
 * club recruitment and gigs link to their authoritative surfaces instead of
 * duplicating data. */
export const OPPORTUNITY_CATEGORIES = [
  { value: 'internship', label: 'Internship' },
  { value: 'program', label: 'Program' },
  { value: 'hackathon', label: 'Hackathon' },
  { value: 'competition', label: 'Competition' },
  { value: 'scholarship', label: 'Scholarship' },
  { value: 'collaboration', label: 'Project collaboration' },
  { value: 'club_recruitment', label: 'Club recruitment' },
  { value: 'gig', label: 'Student gig' },
  { value: 'other', label: 'Other' },
];

export const EVENT_STATUS = ['draft', 'published', 'cancelled', 'completed', 'archived'];
export const RSVP_STATUS = ['going', 'interested', 'not_going', 'waitlist'];

export const ACHIEVEMENTS = [
  { key: 'early_contributor', label: 'Early Contributor', description: 'Published one of the first posts on Campus+.', rule: 'posts_count >= 1 (first 100 members)' },
  { key: 'community_builder', label: 'Community Builder', description: 'Created a community that has members.', rule: 'communities_created >= 1' },
  { key: 'helpful_member', label: 'Helpful Member', description: 'Received 10 reactions on comments.', rule: 'comment_reactions_received >= 10' },
  { key: 'event_participant', label: 'Event Participant', description: 'RSVPed to a campus event.', rule: 'event_rsvps >= 1' },
  { key: 'marketplace_seller', label: 'Marketplace Seller', description: 'Completed a marketplace listing as seller.', rule: 'listings_sold >= 1' },
  { key: 'project_showcase_contributor', label: 'Project Showcase Contributor', description: 'Published a project to the showcase.', rule: 'projects_published >= 1' },
];

/* -------------------------------------------------------------------------- */
/* Feature flags — defaults, mirrored by the feature_flags table               */
/* -------------------------------------------------------------------------- */

export const FEATURE_FLAGS = [
  { key: 'random_confessions', label: 'Random Confessions', description: 'Moderated asynchronous anonymous confessions.', group: 'social', enabled: true },
  { key: 'feed', label: 'Campus feed', description: 'Home timeline, posts, comments and reactions.', group: 'social', enabled: true },
  { key: 'discussions', label: 'Discussions', description: 'Question/answer style text discussions.', group: 'social', enabled: true },
  { key: 'polls', label: 'Polls', description: 'Text polls with single-choice voting.', group: 'social', enabled: true },
  { key: 'communities', label: 'Communities', description: 'Communities, membership and group discussions.', group: 'social', enabled: true },
  { key: 'group_chat', label: 'Group chat', description: 'Community/study-group chat rooms.', group: 'social', enabled: true },
  { key: 'direct_messages', label: 'Direct messages', description: 'One-to-one conversations.', group: 'messaging', enabled: true },
  { key: 'gifs', label: 'GIFs', description: 'GIPHY-backed GIF search inside text surfaces.', group: 'messaging', enabled: true },
  // Random Chat has been withdrawn from the product: no nav link, no /random
  // route, no composer. The row stays in the admin flags list for historical
  // accuracy, but nothing currently reads it to gate anything (the feature's
  // real gate was always the `use_random_chat` permission and the page itself —
  // the page no longer exists). The tables, RPCs, RLS policies and the
  // moderator "Random reports" queue are all intentionally kept: existing data
  // is preserved and staff can still review and resolve reports already filed
  // against past sessions.
  { key: 'random_chat', label: 'Random (retired — no UI entry point)', description: 'Anonymous paired conversations between verified students. Removed from navigation; data and moderation tools are retained.', group: 'messaging', enabled: false },
  { key: 'marketplace', label: 'Marketplace', description: 'Student listings, categories and seller contact.', group: 'market', enabled: true },
  { key: 'gigs', label: 'Campus gigs', description: 'Student service gig board.', group: 'market', enabled: true },
  { key: 'free_stuff', label: 'Free stuff', description: 'Give-away listings.', group: 'market', enabled: true },
  { key: 'deals', label: 'Campus deals', description: 'Official moderator-managed deals.', group: 'market', enabled: true },
  { key: 'housing', label: 'Roommates & housing', description: 'Text housing board.', group: 'market', enabled: true },
  { key: 'rides', label: 'Rides & carpool', description: 'Ride coordination board.', group: 'market', enabled: true },
  { key: 'events', label: 'Events', description: 'Official events and RSVPs.', group: 'campus', enabled: true },
  { key: 'clubs', label: 'Clubs', description: 'Club pages and membership.', group: 'campus', enabled: true },
  { key: 'noticeboard', label: 'Noticeboard', description: 'Official notices.', group: 'campus', enabled: true },
  { key: 'lost_found', label: 'Lost & found', description: 'Text lost/found reports.', group: 'campus', enabled: true },
  { key: 'resources', label: 'Resource hub', description: 'Academic resource links and notes.', group: 'campus', enabled: true },
  { key: 'study_groups', label: 'Study groups', description: 'Subject-based study groups.', group: 'campus', enabled: true },
  { key: 'team_finder', label: 'Team finder', description: 'Looking-for-teammates posts.', group: 'campus', enabled: true },
  { key: 'study_partners', label: 'Study partner finder', description: 'Opt-in subject/exam study requests.', group: 'campus', enabled: true },
  { key: 'projects', label: 'Project showcase', description: 'Text project showcase.', group: 'campus', enabled: true },
  { key: 'opportunities', label: 'Opportunities', description: 'Internships and opportunities.', group: 'campus', enabled: true },
  { key: 'campus_info', label: 'Campus information', description: 'Directory, locations, services, transport, cafeteria, calendar, forms, help.', group: 'campus', enabled: true },
  { key: 'achievements', label: 'Achievements', description: 'Deterministic profile achievements.', group: 'profile', enabled: true },
  { key: 'reputation', label: 'Reputation & ratings', description: 'Marketplace trust indicators.', group: 'profile', enabled: true },
];

export const FEATURE_FLAG_KEYS = FEATURE_FLAGS.map((f) => f.key);

/* -------------------------------------------------------------------------- */
/* Rate limits — enforced server-side (lib/ratelimit.js + SQL function)        */
/* -------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */
/* Search scopes — one list, used by the UI and by lib/search.js               */
/* -------------------------------------------------------------------------- */

export const SEARCH_SCOPES = [
  { value: 'all', label: 'Everything' },
  { value: 'people', label: 'People' },
  { value: 'posts', label: 'Posts' },
  { value: 'discussions', label: 'Discussions' },
  { value: 'communities', label: 'Communities' },
  { value: 'clubs', label: 'Clubs' },
  { value: 'marketplace', label: 'Marketplace' },
  { value: 'events', label: 'Events' },
  { value: 'resources', label: 'Resources' },
  { value: 'opportunities', label: 'Opportunities' },
  { value: 'projects', label: 'Projects' },
  { value: 'study', label: 'Study & teams' },
];

export const SCOPE_LABELS = Object.fromEntries(SEARCH_SCOPES.map((scope) => [scope.value, scope.label]));

export const RATE_LIMITS = {
  // Sign-in is Google OAuth: it sends no mail and issues no code, so there is
  // no pre-authentication bucket left to consume (the old otp_request /
  // otp_verify buckets were removed with the one-time-code flow).
  confession_submit: { limit: 2, windowSeconds: 86400, label: 'accepted confessions per IST day' },
  post_create: { limit: 10, windowSeconds: 600, label: 'posts per 10 minutes' },
  comment_create: { limit: 30, windowSeconds: 600, label: 'comments per 10 minutes' },
  reaction_toggle: { limit: 120, windowSeconds: 600, label: 'reactions per 10 minutes' },
  message_send: { limit: 60, windowSeconds: 600, label: 'messages per 10 minutes' },
  gif_search: { limit: 30, windowSeconds: 60, label: 'GIF searches per minute' },
  listing_create: { limit: 5, windowSeconds: 3600, label: 'listings per hour' },
  report_create: { limit: 10, windowSeconds: 3600, label: 'reports per hour' },
  random_join: { limit: 12, windowSeconds: 3600, label: 'Random joins per hour' },
  random_next: { limit: 8, windowSeconds: 600, label: 'Random rematches per 10 minutes' },
  username_change: { limit: 2, windowSeconds: 2592000, label: 'username changes per 30 days' },
  community_create: { limit: 3, windowSeconds: 86400, label: 'communities per day' },
  search_query: { limit: 120, windowSeconds: 60, label: 'searches per minute' },
  auth_probe: { limit: 20, windowSeconds: 600, label: 'sign-in attempts per 10 minutes' },
  admin_action: { limit: 200, windowSeconds: 3600, label: 'administrative actions per hour' },
};

/* -------------------------------------------------------------------------- */
/* Platform settings — defaults written by migration 100                       */
/* -------------------------------------------------------------------------- */

export const DEFAULT_PLATFORM_SETTINGS = {
  allowed_email_domains: DEFAULT_ALLOWED_EMAIL_DOMAINS,
  confession_daily_limit: 2,
  marketplace_approval_mode: 'post_moderation', // or 'pre_moderation'
  username_change_cooldown_days: 30,
  community_creation_open: true,
  student_opportunity_submission: true,
  random_session_max_minutes: 60,
  random_rematch_cooldown_seconds: 30,
  random_retention_days: 90,
  feed_ranking: 'deterministic_v1',
  show_attendees: true,
  announcement_banner: '',
  support_contact: '',
};

/* -------------------------------------------------------------------------- */
/* Trending                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Deterministic trending score. No machine learning, no hidden signals.
 *
 *   score = (reactions * 2 + comments * 3 + unique_participants) / (age_hours + 2) ^ 1.5
 *
 * Implemented as SQL in migration 009 (`trending_posts`) and mirrored here for
 * tests and documentation.
 */
export const TRENDING_FORMULA =
  'score = (reactions * 2 + comments * 3 + unique_participants) / pow(age_hours + 2, 1.5)';

export function trendingScore({ reactions = 0, comments = 0, participants = 0, createdAt, now = Date.now() }) {
  const ageHours = Math.max(0, (now - new Date(createdAt).getTime()) / 3_600_000);
  const raw = reactions * 2 + comments * 3 + participants;
  return raw / Math.pow(ageHours + 2, 1.5);
}

export const TRENDING_WINDOW_HOURS = 72;

/* -------------------------------------------------------------------------- */
/* Routes (deep links) — one place, used by notifications/search/UI            */
/* -------------------------------------------------------------------------- */

/** Canonical UUID test shared by every route/param guard. */
export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const ROUTES = {
  // The signed-out destination. Kept here like every other deep link so the
  // sign-out flow cannot drift from the proxy's own notion of the route.
  login: '/login',
  home: '/home',
  explore: '/explore',
  market: '/market',
  communities: '/communities',
  campus: '/campus',
  teams: '/campus/teams',
  teamNew: '/campus/teams/new',
  study: '/campus/study',
  studyNew: '/campus/study/new',
  lostFound: '/campus/lost-found',
  lostFoundNew: '/campus/lost-found/new',
  chat: '/chat',
  // No `random` route: Random Chat has no UI entry point (see lib/constants.js
  // FEATURE_FLAGS comment below) — the tables, RPCs and moderation queue are
  // intentionally retained, there is just no page or nav link to reach them.
  profile: '/profile',
  notifications: '/notifications',
  settings: '/settings',
  admin: '/admin',
  moderator: '/moderator',
  user: (username) => `/user/${username}`,
  post: (id) => `/post/${id}`,
  listing: (id) => `/market/listing/${id}`,
  gig: (id) => `/market/gigs/${id}`,
  community: (slug) => `/communities/${slug}`,
  club: (id) => `/campus/clubs/${id}`,
  event: (id) => `/campus/events/${id}`,
  notice: (id) => `/campus/noticeboard/${id}`,
  resource: (id) => `/explore/resources/${id}`,
  opportunity: (id) => `/explore/opportunities/${id}`,
  project: (id) => `/explore/projects/${id}`,
  studyPost: (id) => `/campus/study/${id}`,
  conversation: (id) => `/chat/${id}`,
};

export const PRIMARY_NAV = [
  { href: '/confessions', label: 'Confessions', icon: 'comment' },
  { href: ROUTES.home, label: 'Home', icon: 'home' },
  { href: ROUTES.explore, label: 'Explore', icon: 'search' },
  { href: ROUTES.market, label: 'Market', icon: 'tag' },
  { href: ROUTES.communities, label: 'Communities', icon: 'users' },
  { href: ROUTES.campus, label: 'Campus', icon: 'building' },
  { href: ROUTES.profile, label: 'Profile', icon: 'user' },
];

export const MOBILE_NAV = [
  { href: ROUTES.home, label: 'Home', icon: 'home' },
  { href: ROUTES.explore, label: 'Explore', icon: 'search' },
  { href: ROUTES.market, label: 'Market', icon: 'tag' },
  { href: ROUTES.chat, label: 'Chat', icon: 'chat' },
  { href: ROUTES.profile, label: 'Profile', icon: 'user' },
];
