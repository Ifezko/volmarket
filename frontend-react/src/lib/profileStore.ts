// Per-wallet profile (username + avatar), stored locally. There's no shared profile backend yet, so
// this personalizes the SIGNED-IN user's own view: their username/avatar show wherever their address
// would (their profile, the nav, "you" rows in groups). Other users still fall back to the generated
// handle until a shared name store exists. Swap the get/set for that store when it lands.

export interface Profile {
  username?: string
  avatar?: string // small data: URL (see resizeAvatar) or empty for the generated default
}

const key = (addr: string) => `vm:profile:${addr}`

export function getProfile(addr?: string | null): Profile {
  if (!addr) return {}
  try {
    const raw = localStorage.getItem(key(addr))
    return raw ? (JSON.parse(raw) as Profile) : {}
  } catch {
    return {}
  }
}

export function setProfile(addr: string, p: Profile): void {
  try {
    localStorage.setItem(key(addr), JSON.stringify(p))
  } catch {
    /* quota / private mode - ignore, the UI keeps the in-memory copy for this session */
  }
}

// Downscale an uploaded image to a small square data URL so it fits comfortably in localStorage and
// renders crisply at avatar size. Rejects non-images.
export function resizeAvatar(file: File, size = 96): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) return reject(new Error('Please choose an image file.'))
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      const canvas = document.createElement('canvas')
      canvas.width = size
      canvas.height = size
      const ctx = canvas.getContext('2d')
      if (!ctx) return reject(new Error('Could not process image.'))
      // cover-crop to a centered square
      const scale = Math.max(size / img.width, size / img.height)
      const w = img.width * scale
      const h = img.height * scale
      ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h)
      resolve(canvas.toDataURL('image/jpeg', 0.85))
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Could not load that image.'))
    }
    img.src = url
  })
}

// Deterministic gradient for the generated (no-upload) avatar, derived from the address so it's
// stable per wallet. Returned as a CSS background value.
export function avatarGradient(addr?: string | null): string {
  let h = 0
  for (let i = 0; i < (addr ?? '').length; i++) h = (h * 31 + (addr as string).charCodeAt(i)) >>> 0
  const a = h % 360
  const b = (a + 60 + (h % 120)) % 360
  return `linear-gradient(135deg, hsl(${a} 70% 55%), hsl(${b} 70% 45%))`
}
