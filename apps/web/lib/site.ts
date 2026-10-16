export const SITE = {
  name: 'Neighborline',
  group: 'Eastside Mutual Aid',
  promise: 'Leave a voice note in any language. Two neighbors approve. The money lands in PayPal or Venmo in about 90 seconds.',
  github: 'https://github.com/neighborline/neighborline',
  threatModel: 'https://github.com/neighborline/neighborline/blob/main/THREAT_MODEL.md',
  hackathon: 'PayPal AI Hackathon',
};

export const NAV = [
  { href: '/demo', label: 'Live demo' },
  { href: '/call', label: 'Ask for help' },
  { href: '/organizer', label: 'Organizers' },
  { href: '/donate', label: 'Donate' },
  { href: '/report', label: 'Report' },
  { href: '/trust', label: 'Trust' },
] as const;
