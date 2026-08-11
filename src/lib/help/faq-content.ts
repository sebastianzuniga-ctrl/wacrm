/**
 * Contenido del FAQ de ayuda para ejecutivos/agentes. Separado de la UI
 * (help-content.tsx) y del generador de PDF (help-pdf.ts) para que ambos
 * lean de la misma fuente y nunca queden desincronizados.
 */

export interface FaqItem {
  question: string;
  answer: string;
}

export interface FaqCategory {
  id: string;
  title: string;
  items: FaqItem[];
}

export const FAQ_CATEGORIES: FaqCategory[] = [
  {
    id: "inbox",
    title: "Inbox y conversaciones",
    items: [
      {
        question: "¿Qué significan los estados Open, Pending y Closed de un ticket?",
        answer:
          "Open: la conversación está activa y en curso. Pending: quedó a la espera de algo (por ejemplo, una respuesta del paciente) pero sigue abierta. Closed: la conversación se cerró — ya sea manualmente por un ejecutivo o automáticamente tras 24 horas sin actividad. Un ticket cerrado no se reutiliza: si el mismo paciente vuelve a escribir, se crea un ticket nuevo.",
      },
      {
        question: "¿Cuál es la diferencia entre \"Take over\" y \"Claim\"?",
        answer:
          "\"Take over\" aparece cuando el bot (IA) sigue activo en la conversación y significa que un humano toma el control, pausando la IA. \"Claim\" aparece cuando la IA ya está pausada (por ejemplo, porque el paciente pidió hablar con un ejecutivo) y el ticket no tiene nadie asignado — al hacer clic, la conversación queda asignada a ti y se envía automáticamente un saludo al paciente.",
      },
      {
        question: "¿Por qué no puedo escribir en algunas conversaciones?",
        answer:
          "Si tu rol es Ejecutivo (agent) y la conversación no está asignada a ti (o está asignada a otro ejecutivo), el sistema bloquea el envío de mensajes para evitar que dos personas le escriban al mismo paciente a la vez. Usa el botón \"Claim\" o \"Take over\" para tomar la conversación antes de responder. Los administradores no tienen esta restricción.",
      },
      {
        question: "¿Por qué un ticket se cierra solo después de un tiempo?",
        answer:
          "Si una conversación lleva más de 24 horas sin ningún mensaje nuevo, el sistema la cierra automáticamente. Esto evita que tickets antiguos queden \"abiertos\" para siempre y mantiene las estadísticas más precisas. Si el paciente vuelve a escribir después de eso, se abre un ticket nuevo.",
      },
      {
        question: "El chat no se actualiza solo, ¿está roto?",
        answer:
          "No — el inbox se actualiza automáticamente cada 12 segundos aproximadamente. Si un mensaje nuevo tarda unos segundos en aparecer, es normal. Si after de un minuto completo sigue sin aparecer, usa el botón de \"Actualizar\" manual o recarga la página.",
      },
    ],
  },
  {
    id: "ia",
    title: "El bot / la Inteligencia Artificial",
    items: [
      {
        question: "¿Cuándo responde el bot y cuándo deriva a un humano?",
        answer:
          "El bot responde automáticamente las consultas que puede resolver con la información que tiene (agendamiento, preguntas frecuentes, etc.). Cuando el paciente pide explícitamente hablar con un ejecutivo, o el bot detecta que no puede ayudar con seguridad, deriva la conversación a un humano: se pausa la IA y el ticket queda visible en la cola de \"Esperando ejecutivo\".",
      },
      {
        question: "¿Qué pasa si un paciente pide un ejecutivo fuera del horario de atención?",
        answer:
          "Si está configurado un horario de atención (ver Configuración → WhatsApp), y el paciente pide un ejecutivo fuera de ese horario, el bot NO deriva el ticket — sigue conversando normalmente y le informa al paciente que no hay ejecutivos disponibles en ese momento, indicando el horario de atención. Si un ticket queda esperando ejecutivo y se llega la hora de cierre sin que nadie lo tome, el sistema lo revierte automáticamente al bot y avisa al paciente.",
      },
      {
        question: "¿Cómo pauso o reanudo la IA en una conversación puntual?",
        answer:
          "Dentro del chat, en la parte superior de la conversación, hay un botón para pausar o reanudar la IA en ese ticket específico. Pausar la IA no afecta otras conversaciones — solo esa.",
      },
      {
        question: "¿Por qué a veces el bot no entiende lo que el paciente pide?",
        answer:
          "El bot funciona con inteligencia artificial y puede no reconocer frases muy ambiguas o poco comunes. Si notas que el bot está respondiendo mal de forma repetida en un mismo tema, avísale a tu administrador para revisar y ajustar el comportamiento del bot.",
      },
    ],
  },
  {
    id: "ficha",
    title: "Ficha INO del paciente",
    items: [
      {
        question: "¿Qué es la \"Ficha INO\" que aparece en el chat?",
        answer:
          "Es información del paciente traída directamente del sistema interno de INO (a qué ficha/paciente corresponde ese número de WhatsApp), mostrada junto al chat para dar contexto sin tener que buscar en otro sistema.",
      },
      {
        question: "¿Qué significa si la Ficha INO aparece vacía o no encontrada?",
        answer:
          "Puede significar que el número de WhatsApp todavía no está vinculado a un paciente en el sistema INO (por ejemplo, es un contacto nuevo que aún no se ha atendido presencialmente), o que hubo un problema temporal de conexión con el sistema. No es necesariamente un error — simplemente no hay ficha para vincular todavía.",
      },
    ],
  },
  {
    id: "campanas",
    title: "Campañas, plantillas y \"No Molestar\"",
    items: [
      {
        question: "¿Qué es una plantilla de WhatsApp?",
        answer:
          "Es un mensaje pre-aprobado por WhatsApp/Meta que se puede enviar a pacientes fuera de la ventana normal de conversación (24 horas). Se usan para campañas masivas, como recordatorios o avisos.",
      },
      {
        question: "¿Qué son las \"reglas de respuesta\" de una campaña?",
        answer:
          "Cuando se manda una plantilla con botones (por ejemplo \"SI\" / \"NO\"), se puede configurar qué pasa automáticamente según el botón que toque el paciente — por ejemplo, derivar a un ejecutivo, mandar un mensaje de texto fijo, o activar al bot. Esto se configura en la sección \"Reglas de campaña\" (visible solo para administradores).",
      },
      {
        question: "¿Qué es \"No Molestar\" y cómo entra un paciente ahí?",
        answer:
          "Es una lista de pacientes que pidieron explícitamente dejar de recibir mensajes de campañas (cumpliendo la normativa vigente de protección al consumidor). Un paciente entra automáticamente si responde con una frase de rechazo, o puede agregarse manualmente. Los pacientes en \"No Molestar\" siguen pudiendo conversar normalmente con la clínica — la restricción es solo para campañas masivas.",
      },
    ],
  },
  {
    id: "roles",
    title: "Roles y permisos",
    items: [
      {
        question: "¿Por qué no veo todas las secciones del menú lateral?",
        answer:
          "El sistema tiene distintos roles: Ejecutivo (agent), Administrador (admin) y Propietario (owner). Los ejecutivos ven solo el Inbox, el Panel (con su propia vista simplificada) y Notificaciones — el resto de secciones (Contactos, Campañas, Automatizaciones, Configuración, etc.) son solo para administradores. Esto es intencional, no un error.",
      },
      {
        question: "Como Ejecutivo, ¿qué veo en mi Panel/Dashboard?",
        answer:
          "Una vista simplificada con dos partes: \"Esperando ejecutivo\" (la cola de tickets sin asignar que necesitan un humano) y \"Mis conversaciones\" (los tickets ya asignados a ti). No verás las métricas de negocio que sí ve un administrador.",
      },
    ],
  },
  {
    id: "encuesta",
    title: "Encuesta de satisfacción",
    items: [
      {
        question: "¿Qué es la encuesta de satisfacción?",
        answer:
          "Es un mensaje automático de calificación (1 a 5 estrellas) que se puede enviar al paciente justo después de que un ejecutivo cierra manualmente un ticket, para medir qué tan bien se sintió atendido. No se envía en cierres automáticos (por inactividad de 24 horas o fin de horario de atención) — solo cuando un humano cierra el ticket a propósito.",
      },
      {
        question: "¿Está activa hoy la encuesta de satisfacción?",
        answer:
          "Depende de la configuración de la cuenta — puede estar activada o desactivada desde Configuración → WhatsApp por un administrador. Si no ves que se envíe ninguna encuesta al cerrar tickets, probablemente está desactivada por decisión de la clínica.",
      },
    ],
  },
  {
    id: "problemas",
    title: "Problemas comunes",
    items: [
      {
        question: "Mandé un mensaje y no llegó al paciente",
        answer:
          "Revisa si aparece marcado como \"failed\" (fallido) en el chat. Puede deberse a que pasaron más de 24 horas desde el último mensaje del paciente (fuera de la ventana de conversación libre de WhatsApp, se necesita una plantilla aprobada), o a un problema temporal de conexión. Si el problema persiste con varios pacientes distintos, avisa a tu administrador.",
      },
      {
        question: "El paciente dice que me escribió pero no veo el mensaje",
        answer:
          "Espera unos segundos (el inbox se actualiza automáticamente) o usa el botón de actualizar. Si aun así no aparece, contacta a tu administrador para que revise si hay algún problema con la conexión de WhatsApp.",
      },
      {
        question: "¿Qué hago si algo no funciona y no está en este FAQ?",
        answer:
          "Contacta a tu administrador del sistema para que revise el problema.",
      },
    ],
  },
];
