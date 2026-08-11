#!/bin/bash
# Dump diario de la base de datos de wacrm, comprimido, con retención local.
# BackupManager INO (192.168.0.82) recoge esta carpeta como parte de /home
# al hacer su rsync periódico - este script solo garantiza que lo que
# encuentre ahí sea un dump CONSISTENTE, no archivos vivos de Postgres.
# Si el dump falla, avisa por correo a ticket_alert_emails (misma lista
# que usa whatsapp-quality-cron) vía insNotificacion.jsp directo - no
# depende de que wacrm.service esté arriba.
set -uo pipefail

BACKUP_DIR="/home/ino/wacrm/backups/db"
RETENTION_DAYS=30
DATE=$(date +%Y-%m-%d_%H%M%S)
FILENAME="wacrm_${DATE}.dump"
LOGFILE="/home/ino/wacrm/logs/backup-db.log"
INO_NOTIFY_URL="http://sistema.ino.cl/DentWeb12/dent/rest/insNotificacion.jsp"
INO_NOTIFY_TOKEN="$(grep -m1 "^INO_NOTIFY_TOKEN=" /home/ino/wacrm/.env | cut -d= -f2-)"

mkdir -p "$BACKUP_DIR"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOGFILE"
}

alertar_falla() {
  local motivo="$1"
  local emails
  emails=$(docker exec supabase_db_wacrm psql -U postgres -d postgres -t -A -c \
    "SELECT array_to_string(ticket_alert_emails, ',') FROM accounts LIMIT 1;" 2>> "$LOGFILE")
  if [ -z "$emails" ]; then
    log "ALERTA: backup falló (${motivo}) pero no hay ticket_alert_emails configurados - nadie fue notificado."
    return
  fi
  IFS=',' read -ra EMAIL_ARR <<< "$emails"
  for email in "${EMAIL_ARR[@]}"; do
    [ -z "$email" ] && continue
    curl -s -X POST "$INO_NOTIFY_URL" \
      --data-urlencode "token=${INO_NOTIFY_TOKEN}" \
      --data-urlencode "accion=mail" \
      --data-urlencode "ficha=0" \
      --data-urlencode "email=${email}" \
      --data-urlencode "titulo=wacrm: FALLÓ el backup diario de la base de datos" \
      --data-urlencode "msj=El backup automático de la base de datos de wacrm falló hoy ${DATE}.<br>Motivo: ${motivo}.<br>Revisar log en IA-SVR-MAIN: /home/ino/wacrm/logs/backup-db.log" \
      --data-urlencode "tipo=AVISO_INTERNO" > /dev/null 2>> "$LOGFILE"
  done
  log "Alerta de falla enviada a: ${emails}"
}

log "Iniciando backup..."

if ! docker exec supabase_db_wacrm pg_dump -U postgres -d postgres -Fc -f "/tmp/${FILENAME}" 2>> "$LOGFILE"; then
  log "ERROR: pg_dump falló."
  alertar_falla "pg_dump falló dentro del contenedor"
  exit 1
fi

if ! docker cp "supabase_db_wacrm:/tmp/${FILENAME}" "${BACKUP_DIR}/${FILENAME}" 2>> "$LOGFILE"; then
  log "ERROR: docker cp falló al copiar el dump fuera del contenedor."
  alertar_falla "docker cp falló al extraer el dump"
  docker exec supabase_db_wacrm rm -f "/tmp/${FILENAME}"
  exit 1
fi

docker exec supabase_db_wacrm rm -f "/tmp/${FILENAME}"

if [ ! -s "${BACKUP_DIR}/${FILENAME}" ]; then
  log "ERROR: el archivo de backup quedó vacío o no existe."
  alertar_falla "archivo final vacío o inexistente tras la copia"
  exit 1
fi

SIZE=$(du -h "${BACKUP_DIR}/${FILENAME}" | cut -f1)
log "Backup OK: ${FILENAME} (${SIZE})"

find "$BACKUP_DIR" -name "wacrm_*.dump" -type f -mtime "+${RETENTION_DAYS}" -delete
log "Retención aplicada (${RETENTION_DAYS} días)."
