export const DISCORD_DOMAINS = [
  // Main domains
  'discord.com',
  '*.discord.com',
  'discord.gg',
  '*.discord.gg',
  'discordapp.com',
  '*.discordapp.com',

  // CDN and media
  'discord.media',
  '*.discord.media',
  'discordapp.net',
  '*.discordapp.net',
  'cdn.discordapp.com',
  'media.discordapp.net',
  'images-ext-1.discordapp.net',
  'images-ext-2.discordapp.net',

  // Gateway (WebSocket - critical!)
  'gateway.discord.gg',
  'gateway-us-east1-b.discord.gg',
  'gateway-us-east1-c.discord.gg',
  'gateway-us-east1-d.discord.gg',

  // Voice & Video (critical for calls)
  '*.discord.media',
  '*.discordapp.net',

  // Short links
  'dis.gd',
  '*.dis.gd',

  // Other services
  'discord.co',
  '*.discord.co',
  'discordstatus.com',
  '*.discordstatus.com',
  'discord-activities.com',
  '*.discord-activities.com',
  'discord.new',
  '*.discord.new',

  // API endpoints
  'discord.dev',
  '*.discord.dev',
  'discord.design',
  '*.discord.design',

  // Store and merch
  'discord.store',
  '*.discord.store',
  'discordmerch.com',
  '*.discordmerch.com',

  // Games and activities
  'discordsays.com',
  '*.discordsays.com',

  // Additional subdomains
  'dl.discordapp.net',
  'status.discord.com',
  'support.discord.com',
  'support-dev.discord.com',
  'blog.discord.com',
  'feedback.discord.com',
  'merch.discord.com',
  'streamkit.discord.com',
  'canary.discord.com',
  'ptb.discord.com',

  // Cloudflare/CDN endpoints used by Discord
  'discord.cloudflare.com',
  'discordcdn.com',
  '*.discordcdn.com',

  // Discord Nitro
  'discordnitro.com',
  '*.discordnitro.com',

  // Static content
  'static.discord.com',
  'static.discordapp.com',
  'assets.discord.com',
  'assets.discordapp.com'
];

export const LOCAL_PROXY_PORT = 8888;
