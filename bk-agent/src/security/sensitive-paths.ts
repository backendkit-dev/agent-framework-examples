/**
 * @description Deteccion de rutas con credenciales o material sensible.
 *
 * El agente puede pedir leer cualquier archivo dentro del directorio de trabajo;
 * un `.env`, una clave privada o un `credentials.json` acaban en el contexto del
 * modelo (y de ahi al proveedor) sin que el usuario lo note. Esta lista es la
 * base del guard de lectura: cuando una ruta matchea, la lectura requiere
 * aprobacion explicita.
 *
 * La lista proviene del clasificador que existia en el codigo archivado
 * (`legacy/src/skills/handlers/command-classifier.ts`), que nunca llego a
 * aplicarse al camino vivo.
 */

export const SENSITIVE_PATH_PATTERNS: readonly RegExp[] = [
    // Credenciales genericas
    /\bpassword/i,
    /\bpasswd\b/i,
    /\bcredential/i,
    /\bsecret/i,
    /\bprivate[._-]?key/i,
    /\bapi[._-]?key/i,
    /\baccess[._-]?token/i,
    // Claves y certificados
    /\bid_rsa\b/i,
    /\bid_dsa\b/i,
    /\bid_ecdsa\b/i,
    /\bid_ed25519\b/i,
    /\.pem\b/i,
    /\.key\b/i,
    /\.pfx\b/i,
    /\.p12\b/i,
    /\.jks\b/i,
    /\.keystore\b/i,
    // Archivos de entorno y configuracion con secretos
    /(^|[\\/])\.env(\.|$)/i,
    /\.env\b/i,
    /(^|[\\/])\.ssh[\\/]/i,
    /(^|[\\/])\.aws[\\/]/i,
    /(^|[\\/])\.docker[\\/]config\.json/i,
    /(^|[\\/])\.npmrc$/i,
    /(^|[\\/])\.netrc\b/i,
    /(^|[\\/])_netrc\b/i,
    /(^|[\\/])\.git-credentials\b/i,
    /(^|[\\/])\.htpasswd\b/i,
    /credentials\.json/i,
    /service-account\.json/i,
    /service[-_]account.*\.json/i,
    /kubeconfig\b/i,
    /kube-config/i,
    /dockerconfigjson/i,
    /docker-config\.json/i,
    /(^|[\\/])secrets?\.(ya?ml|json|txt)$/i,
    /\.tfvars\b/i,
];

/**
 * @description true si la ruta parece contener credenciales o material sensible.
 * Se evalua sobre la ruta completa (no sobre el contenido).
 */
export function isSensitivePath(filePath: string): boolean {
    if (!filePath) return false;
    return SENSITIVE_PATH_PATTERNS.some((re) => re.test(filePath));
}
