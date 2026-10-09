// Employee photos: avatar() shows the photo (or initials while loading / when there is none); pickPhoto() lets HR add one.
import { photoUrl, uploadPhoto, removePhoto } from './api.js';
import { h, initials, toast, modal } from './ui.js';
import { ctx } from './ctx.js';

const HUES = ['#6c5ce7', '#2563eb', '#0ea5e9', '#14b8a6', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6'];
const hue = (s) => HUES[[...String(s || '')].reduce((a, c) => a + c.charCodeAt(0), 0) % HUES.length];
export function avatar(e, cls = 'sm') {
  const el = h('span', { class: 'avatar ph ' + cls, style: { background: hue(e && e.full_name) } }, initials((e && (e.full_name || e.employee_name)) || '?'));
  if (e && e.photo_path) photoUrl(e.photo_path).then((u) => { if (u) { el.style.backgroundImage = `url("${u}")`; el.classList.add('has'); } });
  return el;
}
export const canPhoto = (e) => ctx.can('manage_hr') || ctx.canEdit || (ctx.can('recruit_add') && e && e.payroll_state === 'pending');

// square-crop and shrink to 320px JPEG in the browser (keeps storage small and fast)
async function shrink(file) {
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('That file is not a picture we can read (use JPG or PNG).')); i.src = URL.createObjectURL(file); });
  const s = Math.min(img.naturalWidth, img.naturalHeight), c = document.createElement('canvas'); c.width = c.height = 320;
  c.getContext('2d').drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 3, s, s, 0, 0, 320, 320);
  return new Promise((res) => c.toBlob(res, 'image/jpeg', 0.86));
}
export function pickPhoto(e, onDone) {
  if (!canPhoto(e)) return;
  modal(`Photo — ${e.full_name}`, (done) => {
    const file = h('input', { type: 'file', accept: 'image/*', capture: 'user', class: 'hidden', onChange: async (ev) => {
      const f = ev.target.files[0]; ev.target.value = ''; if (!f) return;
      try { const b = await shrink(f); const path = await uploadPhoto(e.id, b); e.photo_path = path; done(); toast('Photo saved', 'ok'); if (onDone) onDone(path); } catch (er) { toast(er.message, 'err'); }
    } });
    return h('div', { class: 'stack', style: { alignItems: 'center', textAlign: 'center' } }, avatar(e, 'xxl'), file,
      h('div', { class: 'small muted' }, 'A clear head-and-shoulders photo works best. It is cropped to a square automatically. On a phone you can take it with the camera.'),
      h('div', { class: 'row', style: { justifyContent: 'center' } }, e.photo_path ? h('button', { class: 'btn danger', onClick: async () => { try { await removePhoto(e.id); e.photo_path = null; done(); toast('Photo removed', 'ok'); if (onDone) onDone(null); } catch (er) { toast(er.message, 'err'); } } }, 'Remove') : null,
        h('button', { class: 'btn', onClick: done }, 'Cancel'), h('button', { class: 'btn primary', onClick: () => file.click() }, e.photo_path ? 'Change photo' : 'Add photo')));
  });
}
