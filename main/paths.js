const { app } = require('electron');
const path = require('path');

const DATA = app.getPath('userData');
module.exports = {
  DATA,
  SHARED: path.join(DATA, 'shared'),        // librerías, assets y versiones compartidas
  INSTANCES: path.join(DATA, 'instances'),  // una carpeta por instancia
  JAVA: path.join(DATA, 'java'),
  CONFIG: path.join(DATA, 'config.json'),
  ACCOUNTS: path.join(DATA, 'accounts.json')
};
