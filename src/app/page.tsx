'use client';

import dynamic from 'next/dynamic';

const IntelApp = dynamic(
  () => import('@/components/IntelApp').then((mod) => mod.IntelApp),
  { ssr: false }
);

export default function Home() {
  return <IntelApp />;
}
