import { Tool } from '../api/types';

export function getToolDefinitions(): Tool[] {
    return [
        {
            type: 'function',
            function: {
                name: 'read_file', description: 'Lee un archivo',
                parameters: { type: 'object', properties: { file_path: { type: 'string' } }, required: ['file_path'] }
            }
        },
        {
            type: 'function',
            function: {
                name: 'write_file', description: 'Escribe un archivo completo (requiere confirmación). Usar solo para archivos nuevos o reescrituras totales.',
                parameters: { type: 'object', properties: { file_path: { type: 'string' }, content: { type: 'string' } }, required: ['file_path', 'content'] }
            }
        },
        {
            type: 'function',
            function: {
                name: 'edit_file',
                description: 'Edita un archivo reemplazando una cadena exacta. Más preciso que write_file: solo toca las líneas indicadas. No requiere confirmación. Preferir sobre write_file para modificar archivos existentes.',
                parameters: {
                    type: 'object',
                    properties: {
                        file_path: { type: 'string', description: 'Ruta absoluta al archivo a editar' },
                        old_string: { type: 'string', description: 'Texto exacto a reemplazar. Debe ser único en el archivo; incluir suficiente contexto (líneas vecinas) si es necesario.' },
                        new_string: { type: 'string', description: 'Texto que reemplaza a old_string' },
                        replace_all: { type: 'boolean', description: 'Si true, reemplaza todas las ocurrencias. Por defecto false (falla si old_string aparece más de una vez).' },
                    },
                    required: ['file_path', 'old_string', 'new_string']
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'multi_edit',
                description: 'Applies multiple edits to a single file in one operation (one read, one write). Use instead of calling edit_file repeatedly on the same file.',
                parameters: {
                    type: 'object',
                    properties: {
                        file_path: { type: 'string', description: 'Absolute path to the file to edit' },
                        edits: {
                            type: 'array',
                            description: 'Ordered list of replacements to apply sequentially',
                            items: {
                                type: 'object',
                                properties: {
                                    old_string: { type: 'string', description: 'Exact text to replace (normalized for line endings)' },
                                    new_string: { type: 'string', description: 'Replacement text' },
                                },
                                required: ['old_string', 'new_string'],
                            },
                        },
                    },
                    required: ['file_path', 'edits'],
                },
            },
        },
        {
            type: 'function',
            function: {
                name: 'list_directory', description: 'Lista directorio',
                parameters: { type: 'object', properties: { dir_path: { type: 'string' } }, required: ['dir_path'] }
            }
        },
        {
            type: 'function',
            function: {
                name: 'execute_command', description: 'Ejecuta comando (requiere confirmación)',
                parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] }
            }
        },
        {
            type: 'function',
            function: {
                name: 'ripgrep_search', description: 'Busca con ripgrep',
                parameters: { type: 'object', properties: { pattern: { type: 'string' }, path: { type: 'string' }, file_types: { type: 'string' } }, required: ['pattern'] }
            }
        },
        {
            type: 'function',
            function: {
                name: 'git_diff', description: 'Muestra git diff',
                parameters: { type: 'object', properties: { staged_only: { type: 'boolean' }, file_path: { type: 'string' } } }
            }
        },
        {
            type: 'function',
            function: {
                name: 'vault_search', description: 'Busca en el vault de Obsidian',
                parameters: { type: 'object', properties: { keywords: { type: 'string' } }, required: ['keywords'] }
            }
        },
        {
            type: 'function',
            function: {
                name: 'update_project_context',
                description: 'Actualiza el contexto permanente del proyecto activo (contexto-proyecto.md). NO se compacta. Usar cuando cambie el stack, arquitectura, convenciones, proyectos relacionados o archivos clave.',
                parameters: {
                    type: 'object',
                    properties: {
                        stack: { type: 'string', description: 'Stack técnico completo (frameworks, DB, mensajería, cloud)' },
                        arquitectura: { type: 'string', description: 'Decisiones y patrones de arquitectura del proyecto' },
                        convenciones: { type: 'string', description: 'Convenciones de código, naming, estructura de carpetas' },
                        proyectos_relacionados: { type: 'array', items: { type: 'string' }, description: 'Lista de proyectos relacionados con descripción de la relación (ej: "api-snowq → comparte el JWT")' },
                        archivos_clave: { type: 'array', items: { type: 'string' }, description: 'Archivos o directorios clave del proyecto' },
                        notas: { type: 'string', description: 'Notas adicionales permanentes del proyecto' },
                    }
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'ask_agent',
                description: 'Invoca AUTOMÁTICAMENTE a otro agente de IA del sistema. La respuesta llega en segundos sin intervención humana. PARALELISMO: si emitís 2 o más llamadas ask_agent en la misma respuesta, se ejecutan EN PARALELO (simultáneamente) — úsalo para dividir tareas grandes en batches independientes y multiplicar la velocidad. Usá esta herramienta en lugar de decirle al usuario que "consulte a QA" o "hable con el especialista".',
                parameters: {
                    type: 'object',
                    properties: {
                        agent_id: {
                            type: 'string',
                            description: 'ID del agente a invocar. Valores disponibles: security, infrastructure, architecture, data, backend, frontend, qa-engineer, coder',
                        },
                        question: {
                            type: 'string',
                            description: 'La tarea concreta para el agente. Sé específico: qué debe hacer, analizar o generar.',
                        },
                        context: {
                            type: 'string',
                            description: 'Código, arquitectura, requisitos u otro contexto que el agente necesita para ejecutar la tarea con precisión.',
                        },
                        relevantFiles: {
                            type: 'array',
                            items: { type: 'string' },
                            description: 'Lista de rutas de archivos relevantes para el contexto del agente especialista',
                        },
                    },
                    required: ['agent_id', 'question'],
                },
            },
        },
        {
            type: 'function',
            function: {
                name: 'update_session_memory',
                description: 'Actualiza la memoria persistente del proyecto activo (sesion-actual.md). Usar al completar una tarea, tomar una decisión de diseño, identificar próximos pasos o encontrar/resolver issues.',
                parameters: {
                    type: 'object',
                    properties: {
                        feature: { type: 'string', description: 'Nombre del feature en curso actualmente' },
                        progreso: { type: 'string', description: 'Progreso del feature (ej: "40%", "Fase 1 completa")' },
                        proximos_pasos: { type: 'array', items: { type: 'string' }, description: 'Lista de próximos pasos pendientes' },
                        decisiones: { type: 'array', items: { type: 'string' }, description: 'Decisiones de arquitectura o diseño tomadas' },
                        issues: { type: 'array', items: { type: 'string' }, description: 'Issues activos o problemas encontrados. Array vacío para limpiar la lista.' },
                        notas: { type: 'string', description: 'Notas adicionales de contexto para la próxima sesión' },
                    }
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'extract_to_vault',
                description: 'Extrae un patrón genérico al vault para reuso en otros proyectos. Usar cuando completes un patrón reutilizable (clases base, configuraciones, DTOs, value objects genéricos, fragmentos de infraestructura). NO usar para código específico del negocio.',
                parameters: {
                    type: 'object',
                    properties: {
                        path: {
                            type: 'string',
                            description: 'Ruta relativa dentro del vault (ej: 04-Recursos/Backend/Patrones/my-pattern.md)',
                        },
                        content: {
                            type: 'string',
                            description: 'Contenido del archivo a guardar en el vault',
                        },
                        tags: {
                            type: 'array',
                            items: { type: 'string' },
                            description: 'Tags de categorización (ej: backend, nestjs, typescript, patron)',
                        },
                    },
                    required: ['path', 'content'],
                },
            },
        },
    ];
}
