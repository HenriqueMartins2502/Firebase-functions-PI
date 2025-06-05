import * as admin from "firebase-admin";
import { onRequest } from "firebase-functions/v2/https";
import * as qrcode from "qrcode";
import * as crypto from 'crypto';

// Inicialize o SDK do Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

export const performAuth = onRequest(
  {
    cors: true, // linha para habilitar CORS
    region: "us-central1",
  },
  async (request, response) => { // Aqui é onde espera void | Promise<void>
    try {
      // Validar apiKey e partnerSite
      const { partnerSite, apiKey } = request.body;

      if (!partnerSite || !apiKey) {
        response.status(400).json({ error: "Parâmetros 'partnerSite' e 'apiKey' são obrigatórios." });
        return; // Garante que o caminho da função termine aqui e retorne void
      }

      const partnerDocRef = db.collection('partners').doc(partnerSite);
      const partnerDoc = await partnerDocRef.get();

      if (!partnerDoc.exists) {
        response.status(404).json({ error: "Parceiro não encontrado." });
        return; // Garante que o caminho da função termine aqui e retorne void
      }

      const partnerData = partnerDoc.data();

      if (partnerData?.apiKey !== apiKey) {
        response.status(401).json({ error: "API Key inválida para este parceiro." });
        return; // Garante que o caminho da função termine aqui e retorne void
      }
      if (partnerData?.isActive === false) {
        response.status(403).json({ error: "Parceiro inativo." });
        return; // Garante que o caminho da função termine aqui e retorne void
      }

      //Fim da Validação

      // Gerar loginToken base64
      const token256Chars = crypto.randomBytes(128).toString('hex');

      const loginTokenPayload = {
        apiKey: apiKey,
        partnerSite: partnerSite,
        loginToken: token256Chars,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        user: null,
        loginTime: null,
        requestCount: 0,
        lastRequest: null
      };

      // Criar documento na coleção login
      const loginDocRef = db.collection('login').doc();
      await loginDocRef.set(loginTokenPayload);

      const loginTokenId = loginDocRef.id;

      // O conteúdo do QR Code será o ID do documento do login e o partnerSite
      const qrCodeContent = JSON.stringify({
        loginToken: loginTokenId,
        partnerSite: partnerSite
      });

      // Gerar QR Code com o conteúdo de loginToken
      const qrCodeDataUrl = await qrcode.toDataURL(qrCodeContent, {
        errorCorrectionLevel: 'H',
        margin: 1,
        width: 256
      });

      const qrCodeBase64 = qrCodeDataUrl.split(',')[1];

      // Return qrCodeBase64
      response.status(200).json({
        qrCodeBase64: qrCodeBase64,
        loginTokenId: loginTokenId
      });
      return; // Garante que o caminho de sucesso também termine aqui e retorne void

    } catch (error) {
      console.error("Erro na função performAuth:", error);
      response.status(500).json({ error: "Erro interno do servidor ao processar a autenticação." });
      return; // Garante que o caminho de erro também termine aqui e retorne void
    }
  }
);

export const getLoginStatus = onRequest(
  {
    cors: true, // Habilita CORS
    region: "us-central1",
  },
  async (request, response) => {
    try {
      // A requisição pode ser GET ou POST, mas para simplificar, vou assumir POST com body.

      const { loginTokenId } = request.body;

      if (!loginTokenId) {
        response.status(400).json({ error: "Parâmetro 'loginTokenId' é obrigatório." });
        return;
      }

      const loginDocRef = db.collection('login').doc(loginTokenId);
      const loginDoc = await loginDocRef.get();

      if (!loginDoc.exists) {
        response.status(404).json({ error: "Login token não encontrado." });
        return;
      }

      const loginData = loginDoc.data();

      // Verifica se os campos 'user' e 'loginTime' foram preenchidos pelo app SuperID
      if (loginData?.user && loginData?.loginTime) {
        // Login aprovado
        response.status(200).json({
          status: "approved",
          user: loginData.user, // Pode ser o ID do usuário, email, etc.
          loginTime: loginData.loginTime,
          //incluir outros dados posteriormente
        });
        return;
      } else {
        // Login pendente
        response.status(200).json({
          status: "pending",
          message: "Aguardando escaneamento e aprovação pelo app SuperID."
        });
        return;
      }

    } catch (error) {
      console.error("Erro na função getLoginStatus:", error);
      response.status(500).json({ error: "Erro interno do servidor ao verificar o status do login." });
      return;
    }
  }
);