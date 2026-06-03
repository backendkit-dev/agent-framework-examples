/**
 * @description Tema visual unificado para la CLI.
 * Define la paleta de colores, espaciados y estilos de borde usados
 * por todos los componentes de UI (formatters, spinner, terminal).
 * Inspirado en GitHub Dark con acentos neón para la marca DeepSeek.
 * El desarrollador obtiene una experiencia visual consistente sin
 * depender de variables CSS o temas externos.
 */

export const theme = {
    colors: {
        /** Verde neón — marca principal, prompts, éxito */
        primary: '#00FFAA',
        /** Dorado — warnings, highlights secundarios */
        secondary: '#FFD700',
        /** Rojo coral — errores, acciones destructivas */
        accent: '#FF6B6B',
        /** Fondo principal — casi negro */
        bg: '#0D1117',
        /** Fondo secundario — paneles, cards */
        bgLight: '#161B22',
        /** Bordes y separadores */
        border: '#30363D',
        /** Texto principal */
        text: '#E6EDF3',
        /** Texto tenue — metadatos, timestamps, descripciones */
        textDim: '#8B949E',
        /** Verde — operaciones exitosas */
        success: '#3FB950',
        /** Amarillo — advertencias */
        warning: '#D29922',
        /** Rojo — errores */
        error: '#F85149',
        /** Azul — información, enlaces */
        info: '#58A6FF',
    },
    spacing: {
        xs: 0,
        sm: 1,
        md: 2,
        lg: 3,
        xl: 4,
    },
    border: {
        round: 'round',
        single: 'single',
        double: 'double',
        bold: 'bold',
    },
} as const;

export type Theme = typeof theme;
