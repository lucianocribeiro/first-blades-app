import { Card } from '@/components/ui/Card';
import { requireAuth } from '@/lib/auth';
import { copy } from '@/lib/copy';

export default async function DashboardPage() {
  const profile = await requireAuth();

  return (
    <div className="space-y-4">
      <Card>
        <h2 className="text-xl font-semibold text-secondary">
          {copy.pages.dashboard.welcome}
        </h2>
        <p className="text-neutral mt-1 text-sm">
          {copy.pages.dashboard.loggedAs}{' '}
          <span className="font-medium text-secondary">
            {profile.full_name || profile.email}
          </span>
        </p>
        <p className="text-neutral mt-3 text-sm">
          {copy.pages.dashboard.hint}
        </p>
      </Card>
    </div>
  );
}
