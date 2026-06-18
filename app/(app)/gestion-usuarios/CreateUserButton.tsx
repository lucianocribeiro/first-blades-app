'use client';

import { useState } from 'react';
import { UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { copy } from '@/lib/copy';
import { UserFormModal } from './UserFormModal';
import type { Tables } from '@/supabase/types';

type Supervisor = Pick<Tables<'profiles'>, 'id' | 'full_name' | 'email'>;

export function CreateUserButton({ supervisors }: { supervisors: Supervisor[] }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        variant="primary"
        icon={<UserPlus size={16} />}
        onClick={() => setOpen(true)}
      >
        {copy.gestionUsuarios.createUser}
      </Button>

      <UserFormModal
        open={open}
        onClose={() => setOpen(false)}
        supervisors={supervisors}
      />
    </>
  );
}
