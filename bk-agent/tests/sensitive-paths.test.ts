import { isSensitivePath } from '../src/security/sensitive-paths';

describe('isSensitivePath', () => {
    it('detecta archivos de entorno', () => {
        expect(isSensitivePath('.env')).toBe(true);
        expect(isSensitivePath('C:\\proj\\.env')).toBe(true);
        expect(isSensitivePath('/home/u/proj/.env.local')).toBe(true);
        expect(isSensitivePath('config/.env.production')).toBe(true);
    });

    it('detecta claves y certificados', () => {
        expect(isSensitivePath('~/.ssh/id_rsa')).toBe(true);
        expect(isSensitivePath('/home/u/.ssh/id_ed25519')).toBe(true);
        expect(isSensitivePath('certs/server.pem')).toBe(true);
        expect(isSensitivePath('certs/client.p12')).toBe(true);
        expect(isSensitivePath('keys/private_key.txt')).toBe(true);
        expect(isSensitivePath('secrets/keystore.jks')).toBe(true);
    });

    it('detecta credenciales de servicios', () => {
        expect(isSensitivePath('credentials.json')).toBe(true);
        expect(isSensitivePath('service-account.json')).toBe(true);
        expect(isSensitivePath('config/kubeconfig')).toBe(true);
        expect(isSensitivePath('.aws/credentials')).toBe(true);
        expect(isSensitivePath('.npmrc')).toBe(true);
        expect(isSensitivePath('.netrc')).toBe(true);
        expect(isSensitivePath('terraform.tfvars')).toBe(true);
        expect(isSensitivePath('.git-credentials')).toBe(true);
    });

    it('no marca codigo normal', () => {
        expect(isSensitivePath('src/index.ts')).toBe(false);
        expect(isSensitivePath('src/environment.ts')).toBe(false);
        expect(isSensitivePath('README.md')).toBe(false);
        expect(isSensitivePath('package.json')).toBe(false);
        expect(isSensitivePath('src/security/sensitive-paths.ts')).toBe(false);
        expect(isSensitivePath('')).toBe(false);
    });
});
