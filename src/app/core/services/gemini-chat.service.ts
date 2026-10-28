import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { environment } from '../../../environments/environment';
import { GameMode } from '../models/score.model';
import { AuthService } from './auth.service';
import { GameService } from './game.service';

export type WebSocketConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface ChatMessage {
  id: string;
  role: 'user' | 'model' | 'system';
  text: string;
  timestamp: string;
  candidatesRemaining?: number;
}

const DEFAULT_WS_ENDPOINT = 'wss://api.pedrohercules.dengoso.web.ufersa.dev.br';

@Injectable({ providedIn: 'root' })
export class GeminiChatService {
  private readonly authService = inject(AuthService);
  private readonly gameService = inject(GameService);

  private socket: WebSocket | null = null;

  private readonly statusSignal = signal<WebSocketConnectionStatus>('disconnected');
  private readonly endpointSignal = signal<string>(
    (environment as { websocketUrl?: string }).websocketUrl || DEFAULT_WS_ENDPOINT,
  );
  private readonly messagesSignal = signal<ChatMessage[]>([
    {
      id: 'welcome-msg',
      role: 'system',
      text: 'Olá, piloto! Sou o Chefe de Box RANDANDAN (powered by Google Gemini). Não sei qual é a moto secreta do dia, mas posso analisar seus palpites e dar dicas técnicas do catálogo! Atenção: enviar uma pergunta neste chat zera a sua pontuação na rodada atual.',
      timestamp: this.formatTime(new Date()),
    },
  ]);
  private readonly sendingSignal = signal<boolean>(false);
  private readonly errorSignal = signal<string | null>(null);
  private readonly tokenPreviewSignal = signal<string | null>(null);

  readonly connectionStatus = computed(() => this.statusSignal());
  readonly websocketEndpoint = computed(() => this.endpointSignal());
  readonly messages = computed(() => this.messagesSignal());
  readonly isSending = computed(() => this.sendingSignal());
  readonly errorMessage = computed(() => this.errorSignal());
  readonly tokenPreview = computed(() => this.tokenPreviewSignal());

  constructor() {
    // Assim que o usuário estiver autenticado no Amazon Cognito, gera os tokens
    // de acesso e estabelece a conexão WebSocket autenticada com o API Gateway.
    effect(() => {
      const auth = this.authService.authState();
      if (auth.status === 'authenticated') {
        void this.connect();
      } else {
        this.disconnect();
      }
    });
  }

  /**
   * Atualiza o endpoint WebSocket (útil caso o usuário queira alternar ou testar outro DNS)
   * e reconecta automaticamente.
   */
  async setEndpointAndReconnect(newEndpoint: string): Promise<void> {
    const cleaned = newEndpoint.trim();
    if (!cleaned) {
      return;
    }
    this.endpointSignal.set(cleaned);
    await this.reconnect();
  }

  /**
   * Força uma nova conexão WebSocket autenticada (ideal para capturar o handshake
   * 101 Switching Protocols na aba Network -> WS do DevTools).
   */
  async reconnect(): Promise<void> {
    this.disconnect();
    await this.connect();
  }

  /**
   * Estabelece a conexão WebSocket autenticada com o Amazon API Gateway
   * anexando o Access Token do Amazon Cognito.
   */
  async connect(): Promise<boolean> {
    if (typeof WebSocket === 'undefined') {
      return false;
    }

    if (
      this.socket &&
      (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)
    ) {
      return true;
    }

    const auth = this.authService.authState();
    if (auth.status !== 'authenticated') {
      this.errorSignal.set('Faça login no Amazon Cognito para conectar ao chat WebSocket.');
      this.statusSignal.set('disconnected');
      return false;
    }

    this.statusSignal.set('connecting');
    this.errorSignal.set(null);

    const token = await this.authService.getAccessToken();
    if (!token) {
      this.statusSignal.set('error');
      this.errorSignal.set('Não foi possível obter o token de acesso do Amazon Cognito.');
      return false;
    }

    this.tokenPreviewSignal.set(`${token.slice(0, 18)}...${token.slice(-10)}`);

    const baseUrl = this.endpointSignal().replace(/\/+$/, '');
    const separator = baseUrl.includes('?') ? '&' : '?';
    const authenticatedWsUrl = `${baseUrl}${separator}token=${encodeURIComponent(token)}`;

    return new Promise<boolean>((resolve) => {
      try {
        const ws = new WebSocket(authenticatedWsUrl);
        this.socket = ws;

        ws.onopen = () => {
          console.info(
            `[RANDANDAN WebSocket] Conexão autenticada estabelecida com ${baseUrl} (rota $default)`,
          );
          this.statusSignal.set('connected');
          this.errorSignal.set(null);
          resolve(true);
        };

        ws.onmessage = (event: MessageEvent) => {
          this.handleIncomingMessage(event.data);
        };

        ws.onerror = () => {
          console.error(`[RANDANDAN WebSocket] Erro na conexão com ${baseUrl}`);
          this.statusSignal.set('error');
          this.sendingSignal.set(false);
          this.errorSignal.set(
            `Falha na conexão WebSocket com ${baseUrl}. Verifique se a API WebSocket e o domínio customizado estão ativos.`,
          );
          resolve(false);
        };

        ws.onclose = () => {
          if (this.socket === ws) {
            this.socket = null;
          }
          if (this.statusSignal() !== 'error') {
            this.statusSignal.set('disconnected');
          }
          this.sendingSignal.set(false);
        };
      } catch (err) {
        this.statusSignal.set('error');
        this.errorSignal.set((err as Error)?.message || 'Erro ao criar conexão WebSocket.');
        resolve(false);
      }
    });
  }

  /** Encerra a conexão WebSocket ativa. */
  disconnect(): void {
    if (this.socket) {
      try {
        this.socket.close();
      } catch {
        // Ignora erro ao fechar socket
      }
      this.socket = null;
    }
    this.statusSignal.set('disconnected');
    this.sendingSignal.set(false);
  }

  /**
   * Envia uma pergunta pelo WebSocket para a rota `$default` do API Gateway.
   * Ao enviar a pergunta, zera imediatamente a pontuação da rodada atual do jogador.
   */
  async sendQuestion(questionText: string, mode: GameMode): Promise<void> {
    const trimmed = questionText.trim();
    if (!trimmed) {
      return;
    }

    if (this.authService.authState().status !== 'authenticated') {
      this.errorSignal.set('Você precisa estar autenticado no Cognito para usar o chat.');
      return;
    }

    // Garante que o WebSocket está conectado antes de enviar
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      const connected = await this.connect();
      if (!connected || !this.socket || this.socket.readyState !== WebSocket.OPEN) {
        return;
      }
    }

    // Zera a pontuação da partida atual conforme regra do jogo
    this.gameService.markAiChatUsed(mode);

    const round = this.gameService.getRound(mode);
    const historyForGemini = this.messagesSignal()
      .filter((m) => m.role === 'user' || m.role === 'model')
      .slice(-6)
      .map((m) => ({ role: m.role, text: m.text }));

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      text: trimmed,
      timestamp: this.formatTime(new Date()),
    };

    this.messagesSignal.update((prev) => [...prev, userMsg]);
    this.sendingSignal.set(true);
    this.errorSignal.set(null);

    // Payload enviado ao API Gateway WebSocket (encaminhado para a Lambda via rota $default).
    // Nunca inclui round.target (a Lambda/Gemini não sabe qual é a moto secreta).
    const payload = {
      action: '$default',
      message: trimmed,
      guesses: round.guesses.map((g) => ({
        motorcycle: {
          manufacturer: g.motorcycle.manufacturer,
          model: g.motorcycle.model,
          style: g.motorcycle.style,
          displacementCc: g.motorcycle.displacementCc,
          weightKg: g.motorcycle.weightKg,
        },
        manufacturerStatus: g.manufacturerStatus,
        modelStatus: g.modelStatus,
        styleStatus: g.styleStatus,
        displacementStatus: g.displacementStatus,
        weightStatus: g.weightStatus,
      })),
      hints: {
        fipePrice: round.fipeHintUsed ? round.target.fipePrice : undefined,
        topSpeedKmh: round.topSpeedHintUsed ? round.target.topSpeedKmh : undefined,
      },
      history: historyForGemini,
    };

    try {
      this.socket.send(JSON.stringify(payload));
    } catch (err) {
      this.sendingSignal.set(false);
      this.errorSignal.set((err as Error)?.message || 'Erro ao enviar mensagem pelo WebSocket.');
    }
  }

  private handleIncomingMessage(rawData: unknown): void {
    this.sendingSignal.set(false);

    if (typeof rawData !== 'string') {
      return;
    }

    try {
      const parsed = JSON.parse(rawData) as {
        type?: string;
        reply?: string;
        message?: string;
        error?: string;
        candidatesRemaining?: number;
      };

      if (parsed.error) {
        this.errorSignal.set(parsed.error);
        return;
      }

      const replyText =
        parsed.reply ||
        parsed.message ||
        'Recebi sua mensagem no box, mas não consegui formatar a dica.';

      const botMsg: ChatMessage = {
        id: `model-${Date.now()}`,
        role: 'model',
        text: replyText,
        timestamp: this.formatTime(new Date()),
        candidatesRemaining: parsed.candidatesRemaining,
      };

      this.messagesSignal.update((prev) => [...prev, botMsg]);
    } catch {
      // Caso a Lambda retorne texto puro pelo WebSocket
      const botMsg: ChatMessage = {
        id: `model-${Date.now()}`,
        role: 'model',
        text: rawData,
        timestamp: this.formatTime(new Date()),
      };
      this.messagesSignal.update((prev) => [...prev, botMsg]);
    }
  }

  private formatTime(date: Date): string {
    return date.toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }
}
