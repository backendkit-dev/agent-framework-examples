export type FieldType =
    | 'uuid' | 'string' | 'text' | 'integer' | 'bigint'
    | 'decimal' | 'boolean' | 'timestamp' | 'json' | 'jsonb';

export interface EntityField {
    name: string;
    type: FieldType;
    primary?: boolean;
    unique?: boolean;
    nullable?: boolean;
    default?: string;
    references?: { entity: string; field: string };
    length?: number;
}

export interface EntityIndex {
    fields: string[];
    unique?: boolean;
}

export interface EntityDef {
    name: string;
    fields: EntityField[];
    indexes?: EntityIndex[];
}

const PG_TYPES: Record<FieldType, string> = {
    uuid:      'UUID',
    string:    'VARCHAR',
    text:      'TEXT',
    integer:   'INTEGER',
    bigint:    'BIGINT',
    decimal:   'DECIMAL(10,2)',
    boolean:   'BOOLEAN',
    timestamp: 'TIMESTAMPTZ',
    json:      'JSON',
    jsonb:     'JSONB',
};

export function entityToSQL(entity: EntityDef): string {
    const table = toSnake(entity.name);
    const columnLines: string[] = [];
    const fkLines: string[] = [];

    for (const field of entity.fields) {
        const col = toSnake(field.name);
        let pgType = PG_TYPES[field.type];
        if (field.type === 'string' && field.length) pgType = `VARCHAR(${field.length})`;
        else if (field.type === 'string') pgType = 'VARCHAR(255)';

        const parts: string[] = [col, pgType];

        if (field.primary) {
            parts.push('PRIMARY KEY');
        } else {
            if (field.unique) parts.push('UNIQUE');
            if (!field.nullable) parts.push('NOT NULL');
        }

        if (field.default !== undefined) {
            parts.push(`DEFAULT ${field.default}`);
        }

        columnLines.push(`  ${parts.join(' ')}`);

        if (field.references) {
            const refTable = toSnake(field.references.entity);
            const refCol = toSnake(field.references.field);
            fkLines.push(`  CONSTRAINT fk_${table}_${col} FOREIGN KEY (${col}) REFERENCES ${refTable}(${refCol}) ON DELETE CASCADE`);
        }
    }

    const allLines = [...columnLines, ...fkLines];
    let sql = `CREATE TABLE IF NOT EXISTS ${table} (\n${allLines.join(',\n')}\n);`;

    if (entity.indexes?.length) {
        sql += '\n';
        for (const idx of entity.indexes) {
            const cols = idx.fields.map(toSnake);
            const idxName = `idx_${table}_${cols.join('_')}`;
            const unique = idx.unique ? 'UNIQUE ' : '';
            sql += `\nCREATE ${unique}INDEX IF NOT EXISTS ${idxName} ON ${table} (${cols.join(', ')});`;
        }
    }

    return sql;
}

export function entitiesToMigration(entities: EntityDef[]): string {
    const parts: string[] = [
        '-- Auto-generated migration',
        `-- Generated at: ${new Date().toISOString()}`,
        '',
        '-- Enable UUID extension',
        'CREATE EXTENSION IF NOT EXISTS "pgcrypto";',
        '',
    ];

    for (const entity of entities) {
        parts.push(`-- Table: ${toSnake(entity.name)}`);
        parts.push(entityToSQL(entity));
        parts.push('');
    }

    return parts.join('\n');
}

function toSnake(s: string): string {
    return s
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
        .replace(/([a-z])([A-Z])/g, '$1_$2')
        .toLowerCase();
}
