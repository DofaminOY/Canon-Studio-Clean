import { createServer } from './http/router.js';
import { HOST, PORT } from './config.js';

const server = createServer();
server.listen(PORT, HOST, () => {
  console.log(`Canon Studio: http://${HOST}:${PORT}`);
  console.log('Оставь терминал открытым. Ctrl+C — остановка сервера.');
});
