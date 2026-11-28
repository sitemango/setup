import Link from 'next/link';
import { Badge } from '@/components/ui';
import { Icon } from '@/components/ui/icons';
import { hasVerifiedRecruitment } from '@/lib/discovery/public';
import { ClubLogo } from '@/components/clubs/ClubLogo';
import { clubLogoSrc } from '@/lib/clubs/logos';
import { truncate } from '@/lib/utils';
import { ROUTES, CLUB_CATEGORIES, CLUB_ORGANIZATION_TYPE_LABELS } from '@/lib/constants';

const CATEGORY_ICON_MAP = Object.fromEntries(
  CLUB_CATEGORIES.map((c) => [c.value, c.icon]),
);

/**
 * Truthful discovery states sourced from the club and the viewer's real rows.
 * `href` is the canonical slug URL — the UUID is only used by ClubMonogram to
 * derive its (non-identifying) colour and is NEVER a public link. Membership
 * badges are viewer-gated: a guest must not see a "Member" or "Join requested"
 * state that can only be known from a signed-in student's private rows.
 */
export function ClubCard({ club, joined = false, pending = false, viewer = false, showRecruitmentStatus = true }) {
  const canRecruit = showRecruitmentStatus && hasVerifiedRecruitment(club);
  const organizationType = CLUB_ORGANIZATION_TYPE_LABELS[club.organization_type] || 'Club';
  const categoryIcon = CATEGORY_ICON_MAP[club.club_category] || 'star';
  const href = club.slug ? ROUTES.club(club.slug) : ROUTES.clubLegacy(club.id);

  return (
    <Link
      href={href}
      className="club-card group"
      aria-label={`${club.name}, ${club.member_count} member${club.member_count === 1 ? '' : 's'}${club.admin_assigned ? '' : ', administrator assignment needed'}`}
    >
      {/* 1. Dedicated upper visual section occupying approximately 40-45% of the card */}
      <div className="club-card__visual">
        <div className="club-card__visual-header">
          <span className="club-card__category-badge">
            <Icon name={categoryIcon} size={11} className="shrink-0 text-muted" />
            <span className="truncate">{club.club_category || 'Club'}</span>
          </span>
          <span className="club-card__action" aria-hidden="true" title="Open club">
            <Icon name="arrowUpRight" size={14} className="club-card__action-icon" />
          </span>
        </div>

        <div className="club-card__visual-hero">
          <ClubLogo src={clubLogoSrc(club.slug)} name={club.name} id={club.id} size={58} className="club-card__monogram" />
        </div>
      </div>

      {/* 2. Separate lower information section */}
      <div className="club-card__body">
        {/* Title and subtitle hierarchy */}
        <div className="club-card__header">
          <h3 className="club-card__title t-card">{club.name}</h3>
          <p className="club-card__subtitle">{organizationType}</p>
        </div>

        {/* Relevant status and governance badges */}
        <div className="club-card__badges" aria-label="Status badges">
          {club.verification_status === 'source_checked' ? (
            <Badge tone="accent" icon="check">Source checked</Badge>
          ) : <Badge>Details pending</Badge>}
          {club.is_official ? <Badge tone="accent">Campus+ reviewed</Badge> : null}
          {viewer && joined ? <Badge tone="success" icon="check">Member</Badge> : null}
          {viewer && !joined && pending ? <Badge tone="warning">Join requested</Badge> : null}
          {club.admin_assigned ? <Badge>Administrator assigned</Badge> : <Badge tone="warning">Admin assignment needed</Badge>}
          {canRecruit ? <Badge tone="info" icon="megaphone">Recruiting</Badge> : null}
          {club.admin_assigned && club.join_policy !== 'open' ? <Badge>Approval needed</Badge> : null}
        </div>

        {/* Short description */}
        <p className="club-card__description">
          {truncate(club.description, 140)}
        </p>

        {/* 3. Compact icon-supported metadata row (adapted from Uiverse reference icon-box) */}
        <div className="club-card__footer">
          <div className="club-card__icon-box">
            <div className="club-card__meta-item">
              <Icon name="users" size={14} className="club-card__meta-icon" />
              <span className="club-card__meta-text">
                <strong>{club.member_count}</strong> {club.member_count === 1 ? 'member' : 'members'}
              </span>
            </div>
            {club.meeting_info ? (
              <div className="club-card__meta-item club-card__meta-item--secondary" title={`Meets · ${club.meeting_info}`}>
                <Icon name="calendar" size={12} className="shrink-0 text-muted" />
                <span className="truncate">Meets · {club.meeting_info}</span>
              </div>
            ) : club.source_label ? (
              <div className="club-card__meta-item club-card__meta-item--secondary" title={`Source · ${club.source_label}`}>
                <Icon name="link" size={12} className="shrink-0 text-muted" />
                <span className="truncate">Source · {club.source_label}</span>
              </div>
            ) : null}
          </div>

          {club.meeting_info && club.source_label ? (
            <p className="club-card__source" title={`Source · ${club.source_label}`}>
              Source · {club.source_label}
            </p>
          ) : null}
        </div>
      </div>
    </Link>
  );
}
