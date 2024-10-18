import express from 'express';
import logger from 'morgan';
import dotenv from 'dotenv';
import bcrypt from 'bcrypt';
import { MongoClient } from 'mongodb';
import { Server } from 'socket.io';
import { createServer } from 'node:http';
import bodyParser from 'body-parser';

dotenv.config();

const port = process.env.PORT ?? 3000;
const mongoUrl = process.env.MONGO_URL;

const app = express();
const server = createServer(app);
const io = new Server(server, {
  connectionStateRecovery: {}
});

app.use(logger('dev'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

let usersCollection;
let messagesCollection;

const connectToDB = async () => {
  try {
    const client = new MongoClient(mongoUrl);
    await client.connect();
    const db = client.db('chatDB');
    usersCollection = db.collection('users');
    messagesCollection = db.collection('messages');
    console.log('Conexión a MongoDB exitosa');
  } catch (error) {
    console.error('Error conectando a MongoDB:', error);
  }
};

await connectToDB();

// Ruta para registrar nuevos usuarios
app.post('/register', async (req, res) => {
  const { username, password } = req.body;
  const hashedPassword = await bcrypt.hash(password, 10);
  try {
    await usersCollection.insertOne({ username, password: hashedPassword });
    res.status(201).send('Usuario registrado exitosamente');
  } catch (error) {
    console.error('Error al registrar usuario:', error);
    res.status(500).send('Error en el servidor');
  }
});

// Ruta para iniciar sesión
app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const user = await usersCollection.findOne({ username });
    if (!user) {
      return res.status(400).send('Usuario no encontrado');
    }
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).send('Contraseña incorrecta');
    }
    res.status(200).send('Inicio de sesión exitoso');
  } catch (error) {
    console.error('Error al iniciar sesión:', error);
    res.status(500).send('Error en el servidor');
  }
});

// Ruta para servir el archivo del chat después de iniciar sesión
app.get('/chat', (req, res) => {
  res.sendFile(process.cwd() + '/client/chat.html');
});

app.get('/', (req, res) => {
  res.sendFile(process.cwd() + '/client/login.html');
});

// Middleware de autenticación para Socket.IO
io.use((socket, next) => {
  const username = socket.handshake.auth.username;
  if (!username) {
    return next(new Error('Error de autenticación: Falta el nombre de usuario.'));
  }
  socket.username = username;  // Guardar el username en el socket
  next();
});

io.on('connection', async (socket) => {
  console.log(`${socket.username} se ha conectado`);

  // Recuperar y enviar todos los mensajes guardados cuando un usuario se conecta
  if (messagesCollection) {
    try {
      const messages = await messagesCollection.find({}).toArray();  // Obtener todos los mensajes

      messages.forEach((msg) => {
        socket.emit('chat message', msg.content, msg._id.toString(), msg.user, msg.time);  // Enviar cada mensaje al cliente
      });
    } catch (error) {
      console.error('Error al recuperar los mensajes:', error);
    }
  }

  // Almacenar el mensaje en la base de datos y enviarlo a todos los usuarios conectados
  socket.on('chat message', async (msg) => {
    const username = socket.username;
    const time = new Date().toLocaleTimeString();  // Obtener la hora actual

    if (!messagesCollection) {
      console.error('La colección de mensajes no está inicializada.');
      return;
    }

    try {
      const result = await messagesCollection.insertOne({
        content: msg,
        user: username,
        time: time  // Guardar la hora del mensaje
      });

      // Emitir el mensaje a todos los clientes conectados
      io.emit('chat message', msg, result.insertedId.toString(), username, time);
    } catch (e) {
      console.error('Error al insertar el mensaje:', e);
    }
  });
});

server.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
