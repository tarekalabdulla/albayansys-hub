// ============================================================================
// callDirection — Direction Lock + Ghost Killer
// ----------------------------------------------------------------------------
// منطق تحديد اتجاه المكالمة بدقة من مصادر متعدّدة (Webhook/AMI):
//   - بعد تثبيت الاتجاه (lock=true) لا يتغيّر — يمنع انقلاب inbound→outbound في
//     منتصف الطريق بسبب أحداث متأخرة من ring group أو parallel channels.
//   - Ghost Killer: عند ring group، عدّة قنوات تُرنّ بالتوازي ثم تُلغى عند
//     ردّ أحدها. ندمجها في سجل واحد عبر linkedid.
// ============================================================================

const VALID = new Set(["incoming", "outgoing", "internal", "transferred", "forwarded", "unknown"]);

/**
 * يستنتج الاتجاه من مؤشرات متعددة.
 * @param {object} hints
 * @param {string} hints.eventDirection   - مباشر من payload
 * @param {string} hints.callType         - "1"/"2" أو inbound/outbound
 * @param {string} hints.fromNum
 * @param {string} hints.toNum
 * @param {string} hints.ext
 * @param {string} hints.trunk
 * @param {boolean} hints.isTransfer
 * @param {boolean} hints.isForward
 * @returns {"incoming"|"outgoing"|"internal"|"transferred"|"forwarded"|"unknown"}
 */
export function inferDirection(hints = {}) {
  const { eventDirection, callType, fromNum, toNum, ext, trunk, isTransfer, isForward } = hints;

  if (isTransfer) return "transferred";
  if (isForward)  return "forwarded";

  const d = (eventDirection || "").toString().toLowerCase();
  if (d === "inbound"  || d === "incoming") return "incoming";
  if (d === "outbound" || d === "outgoing") return "outgoing";
  if (d === "internal") return "internal";

  if (callType === "1" || callType === 1) return "outgoing";
  if (callType === "2" || callType === 2) return "incoming";

  // الاستنتاج بالأرقام: extension داخلي عادةً 3-5 أرقام، الخارجي أطول
  const isInternal = (n) => /^\d{2,5}$/.test(String(n || "").trim());
  if (isInternal(fromNum) && isInternal(toNum)) return "internal";

  // إذا الـ trunk موجود فهي تمرّ عبر خط خارجي
  if (trunk) {
    if (isInternal(fromNum) && !isInternal(toNum)) return "outgoing";
    if (!isInternal(fromNum) && isInternal(toNum)) return "incoming";
  }

  // ext الخاص بنا = طرف داخلي
  if (ext) {
    if (String(ext) === String(fromNum)) return "outgoing";
    if (String(ext) === String(toNum))   return "incoming";
  }

  return "unknown";
}

/**
 * Direction Lock — يقرّر هل نطبّق الاتجاه الجديد على السجل أم نتمسّك بالقديم.
 * القاعدة:
 *   - إذا كان مقفلاً، لا تغيّره أبداً.
 *   - إذا الاتجاه الجديد "unknown"، احتفظ بالقديم.
 *   - عند إنهاء المكالمة (final=true) أو وصول webhook (مصدر موثوق)، اقفله.
 */
export function resolveDirection(prev, next, { final = false, fromTrustedSource = false } = {}) {
  const prevDir = prev?.direction || "unknown";
  const prevLocked = !!prev?.direction_locked;

  if (prevLocked) {
    return { direction: prevDir, locked: true, changed: false };
  }
  if (!VALID.has(next) || next === "unknown") {
    return { direction: prevDir, locked: false, changed: false };
  }

  const shouldLock = final || fromTrustedSource;
  return {
    direction: next,
    locked: shouldLock,
    changed: prevDir !== next,
  };
}

/**
 * Ghost Killer — هل هذا الحدث "شبح" يجب تجاهله؟
 *  - ring لقناة في ring group بعد أن رُدّ على قناة أخرى من نفس linkedid
 *  - hangup لقناة فرعية بدون answered_at بينما السجل الرئيسي answered
 */
export function isGhostEvent({ existingLog, eventKind, eventExt }) {
  if (!existingLog) return false;
  // إذا كانت المكالمة قد رُدّت مسبقاً، تجاهل أحداث ring لـ extensions أخرى
  if (existingLog.answered && eventKind === "ring" && eventExt && eventExt !== existingLog.ext) {
    return true;
  }
  // إذا كانت قد انتهت، أي حدث جديد لا يعدّل سجلاً مغلقاً
  if (existingLog.ended_at && eventKind !== "recording") {
    return true;
  }
  return false;
}
