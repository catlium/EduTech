export const MAX_FILE_SIZE = 20 * 1024 * 1024;

export const ALLOWED_FILE_TYPES = new Map<string, { materialType: string; extensions: string[] }>([
  ['application/pdf', { materialType: 'PDF', extensions: ['pdf'] }],
  ['image/png', { materialType: 'IMAGE', extensions: ['png'] }],
  ['image/jpeg', { materialType: 'IMAGE', extensions: ['jpg', 'jpeg'] }],
  ['image/webp', { materialType: 'IMAGE', extensions: ['webp'] }],
  ['image/gif', { materialType: 'IMAGE', extensions: ['gif'] }],
  ['text/plain', { materialType: 'DOCUMENT', extensions: ['txt', 'md', 'text'] }],
  ['application/rtf', { materialType: 'DOCUMENT', extensions: ['rtf'] }],
  ['application/msword', { materialType: 'DOCUMENT', extensions: ['doc'] }],
  [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    { materialType: 'DOCUMENT', extensions: ['docx'] },
  ],
  ['application/vnd.ms-excel', { materialType: 'DOCUMENT', extensions: ['xls'] }],
  [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    { materialType: 'DOCUMENT', extensions: ['xlsx'] },
  ],
]);
