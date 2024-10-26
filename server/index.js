import express from 'express';
import logger from 'morgan';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import { MongoClient, Binary } from 'mongodb';
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
    messagesCollection = db.collection('mensajes');
    console.log('Conexión a MongoDB exitosa');
  } catch (error) {
    console.error('Error conectando a MongoDB:', error);
  }
};

await connectToDB();

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

app.get('/chat', (req, res) => {
  res.sendFile(process.cwd() + '/client/chat.html');
});

app.get('/', (req, res) => {
  res.sendFile(process.cwd() + '/client/login.html');
});

io.use((socket, next) => {
  const username = socket.handshake.auth.username;
  if (!username) {
    return next(new Error('Error de autenticación: Falta el nombre de usuario.'));
  }
  socket.username = username;
  next();
});

io.on('connection', async (socket) => {
  console.log(`${socket.username} se ha conectado`);

  if (messagesCollection) {
    const messages = await messagesCollection.find({}).toArray();
    messages.forEach((msg) => {
      if (msg.type === 'text') {
        socket.emit('chat message', msg.content, msg._id.toString(), msg.user, msg.time);
      } else if (msg.type === 'audio') {
        socket.emit('audio message', msg.content.buffer, msg.user, msg.time);
      }
    });
  }

  socket.on('chat message', async (msg) => {
    const username = socket.username;
    const time = new Date().toLocaleTimeString();

    if (!messagesCollection) return;

    const result = await messagesCollection.insertOne({
      type: 'text',
      content: msg,
      user: username,
      time: time
    });

    io.emit('chat message', msg, result.insertedId.toString(), username, time);
  });

  socket.on('audio message', async (audioBuffer) => {
    const username = socket.username;
    const time = new Date().toLocaleTimeString();

    if (!messagesCollection) return;

    const result = await messagesCollection.insertOne({
      type: 'audio',
      content: new Binary(audioBuffer),
      user: username,
      time: time
    });

    io.emit('audio message', audioBuffer, username, time);
  });
});

server.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
