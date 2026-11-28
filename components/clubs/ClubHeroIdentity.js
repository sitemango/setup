import { Badge } from '@/components/ui';
import { ClubLogo } from '@/components/clubs/ClubLogo';
import { clubLogoSrc } from '@/lib/clubs/logos';
import { LinkifiedText } from '@/components/content/LinkifiedText';
import { CLUB_ORGANIZATION_TYPE_LABELS } from '@/lib/constants';
import { hasVerifiedRecruitment } from '@/lib/discovery/public';

/** Identity and truthful status shared by public and member-facing club views. */
export function ClubHeroIdentity({ club, isMember = false }) {
  return (
    <div className="flex items-start gap-3.5">
      <ClubLogo src={clubLogoSrc(club.slug)} name={club.name} id={club.id} size={64} />
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-ink">{club.name}</p>
        <p className="text-2xs text-muted">{[club.club_category, CLUB_ORGANIZATION_TYPE_LABELS[club.organization_type]].filter(Boolean).join(' · ')}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {club.verification_status === 'source_checked' ? <Badge tone="accent" icon="check">Source checked</Badge> : <Badge>Details pending</Badge>}
          {club.is_official ? <Badge tone="accent">Campus+ reviewed</Badge> : null}
          {club.admin_assigned ? <Badge>Administrator assigned</Badge> : <Badge tone="warning">Admin assignment needed</Badge>}
          {hasVerifiedRecruitment(club) ? <Badge tone="info" icon="megaphone">Recruiting</Badge> : null}
          {club.admin_assigned && club.join_policy !== 'open' ? <Badge>Approval needed</Badge> : null}
          {isMember ? <Badge tone="success" icon="check">Member</Badge> : null}
        </div>
        {club.description ? <p className="user-text mt-2.5 text-[0.9375rem] leading-relaxed"><LinkifiedText text={club.description} mentions /></p> : null}
      </div>
    </div>
  );
}
