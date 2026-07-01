'use client';

import { useState } from 'react';
import SetupChat from './SetupChat';
import SetupPlanPanel from './SetupPlanPanel';

export default function SetupContent() {
  const [refreshKey, setRefreshKey] = useState(0);
  return (
    <div className="flex flex-1 overflow-hidden min-h-0">
      <SetupChat onAssistantReply={() => setRefreshKey((k) => k + 1)} />
      <SetupPlanPanel refreshKey={refreshKey} />
    </div>
  );
}
