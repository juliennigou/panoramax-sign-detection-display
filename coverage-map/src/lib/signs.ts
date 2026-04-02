const EXACT_SIGN_NAMES: Record<string, string> = {
  sign: 'Panneau',
  panneau: 'Panneau',
  panonceau: 'Panonceau',
  plate: 'Panonceau',
  A1a: 'Virage dangereux à droite',
  A2b: "Ralentisseur de type dos-d'ane",
  A13a: 'Endroit frequente par les enfants',
  A13b: 'Annonce de passage pour pietons',
  AB3: 'Cedez-le-passage',
  AB4: 'Stop',
  AB25: 'Carrefour a sens giratoire',
  B1: 'Sens interdit',
  B2a: 'Interdiction de tourner a gauche',
  B2b: 'Interdiction de tourner a droite',
  B6a1: 'Stationnement interdit',
  B6d: 'Arret et stationnement interdits',
  B18c: 'Acces interdit aux vehicules transportant des matieres dangereuses',
  'B21-1': 'Obligation de tourner a droite avant le panneau',
  'B21-2': 'Obligation de tourner a gauche avant le panneau',
  B51: 'Fin de zone 30',
  C1a: 'Parking gratuit',
  C13a: 'Impasse',
  C20a: 'Passage pour pietons',
  C24a: 'Conditions particulieres de circulation',
  C27: 'Surelevation de chaussee',
  C50: 'Indications diverses',
  C113: 'Piste ou bande cyclable conseillee',
  C114: "Fin de piste ou bande cyclable conseillee",
  C115: 'Voie verte',
  C116: 'Fin de voie verte',
  CE14: 'Installation accessible aux personnes handicapees',
  CE16: 'Restaurant',
  J5: "Balise de tete d'ilot",
  M6h: 'Stationnement reserve aux personnes handicapees',
  M6i: 'Stationnement reserve aux vehicules electriques en recharge',
}

const FAMILY_NAMES: Record<string, string> = {
  A: 'Danger',
  AB: 'Intersection et priorite',
  B: 'Prescription',
  C: 'Indication',
  CE: 'Services',
  EB: 'Agglomeration',
  J: 'Balise',
  M: 'Panonceau',
  SUBSIGN: 'Panonceau',
  UNKNOWN: 'Non classe',
}

function normalizeCode(code: string | null | undefined) {
  return code?.trim() ?? ''
}

function rejectLikeLabel(code: string) {
  return code.endsWith('zz') || code.endsWith('ZZ') || code.startsWith('z') || code.startsWith('Z')
}

function compose(parts: string[]) {
  return parts.filter(Boolean).join(' + ')
}

function describeComposite(code: string) {
  const parts = code.split('-')
  if (parts.length <= 1) {
    return null
  }

  if (parts[0] === 'B14' && parts[1]) {
    return `Limitation de vitesse a ${parts[1]} km/h`
  }

  return compose(parts.map((part) => describeSignCode(part) ?? part))
}

export function describeSignCode(code: string | null | undefined): string | null {
  const normalized = normalizeCode(code)
  if (!normalized) {
    return null
  }

  if (EXACT_SIGN_NAMES[normalized]) {
    return EXACT_SIGN_NAMES[normalized]
  }

  const composite = describeComposite(normalized)
  if (composite) {
    return composite
  }

  if (rejectLikeLabel(normalized)) {
    return 'Classe de rejet ou panneau hors nomenclature'
  }

  if (/^B14-\d+$/.test(normalized)) {
    return `Limitation de vitesse a ${normalized.split('-')[1]} km/h`
  }

  if (/^A[A-Za-z0-9-]+$/.test(normalized)) {
    return 'Panneau de danger'
  }
  if (/^AB[A-Za-z0-9-]+$/.test(normalized)) {
    return "Panneau d'intersection et de priorite"
  }
  if (/^B[A-Za-z0-9-]+$/.test(normalized)) {
    return 'Panneau de prescription'
  }
  if (/^CE[A-Za-z0-9-]+$/.test(normalized)) {
    return 'Panneau de services'
  }
  if (/^C[A-Za-z0-9-]+$/.test(normalized)) {
    return "Panneau d'indication"
  }
  if (/^J[A-Za-z0-9-]+$/.test(normalized)) {
    return 'Balise'
  }
  if (/^M[A-Za-z0-9-]+$/.test(normalized)) {
    return 'Panonceau'
  }

  return null
}

export function formatSignCode(code: string | null | undefined) {
  const normalized = normalizeCode(code)
  if (!normalized) {
    return 'n/a'
  }

  const description = describeSignCode(normalized)
  return description ? `${description} (${normalized})` : normalized
}

export function formatSignFamily(family: string | null | undefined) {
  const normalized = normalizeCode(family)
  if (!normalized) {
    return 'Non classe'
  }

  const description = FAMILY_NAMES[normalized]
  return description ? `${description} (${normalized})` : normalized
}
