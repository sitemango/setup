import { LoadingPanel } from '@/components/ui';

export default function StudyLoading() {
  return <LoadingPanel words={['study requests', 'subjects', 'study partners']} rows={4} />;
}
