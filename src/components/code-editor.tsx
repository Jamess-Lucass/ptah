import { useRef, createRef, useEffect } from "react";
import {
  WebSocketMessageReader,
  WebSocketMessageWriter,
  toSocket,
} from "vscode-ws-jsonrpc";
import { MonacoLanguageClient, initServices } from "monaco-languageclient";
import * as monaco from "monaco-editor";
import * as vscode from "vscode";
import {
  CloseAction,
  ErrorAction,
  MessageTransports,
} from "vscode-languageclient";
import { createConfiguredEditor, createModelReference } from "vscode/monaco";
import "@codingame/monaco-vscode-go-default-extension";

const createLanguageClient = (
  transports: MessageTransports
): MonacoLanguageClient => {
  return new MonacoLanguageClient({
    name: "Go LSP",
    clientOptions: {
      documentSelector: ["go"],
      errorHandler: {
        error: () => ({ action: ErrorAction.Continue }),
        closed: () => ({ action: CloseAction.DoNotRestart }),
      },
      workspaceFolder: {
        uri: monaco.Uri.parse("/workspace"),
        name: "workspace",
        index: 0,
      },
    },
    connectionProvider: {
      get: () => {
        return Promise.resolve(transports);
      },
    },
  });
};

export const createJsonEditor = async (config: {
  htmlElement: HTMLElement;
  content: string;
}) => {
  // create the model
  const uri = vscode.Uri.parse("/workspace/main.go");
  const modelRef = await createModelReference(uri, config.content);
  modelRef.object.setLanguageId("go");

  // create monaco editor
  const editor = createConfiguredEditor(config.htmlElement, {
    model: modelRef.object.textEditorModel,
    glyphMargin: true,
    lightbulb: {
      enabled: true,
    },
    automaticLayout: true,
    wordBasedSuggestions: "off",
  });

  const result = {
    editor,
    uri,
    modelRef,
  };
  return Promise.resolve(result);
};

type Props = {
  defaultCode: string;
  setEditor: React.Dispatch<
    React.SetStateAction<monaco.editor.IStandaloneCodeEditor | undefined>
  >;
};

export function CodeEditor({ defaultCode, setEditor }: Props) {
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor>();
  const ref = createRef<HTMLDivElement>();
  let lspWebSocket: WebSocket;

  const isInit = useRef(false);

  useEffect(() => {
    if (isInit.current) return;
    console.log("mounting");
    isInit.current = true;

    const currentEditor = editorRef.current;

    if (ref.current != null) {
      const start = async () => {
        await initServices();
        const { editor } = await createJsonEditor({
          htmlElement: ref.current!,
          content: defaultCode,
        });
        setEditor(editor);
        const webSocket = new WebSocket(
          "wss://hrc.suggest.hackerrank.com/go?user_id=undefined"
        );
        webSocket.onopen = async () => {
          const socket = toSocket(webSocket);
          const reader = new WebSocketMessageReader(socket);
          const writer = new WebSocketMessageWriter(socket);
          const languageClient = createLanguageClient({
            reader,
            writer,
          });
          await languageClient.start();
          reader.onClose(() => languageClient.stop());
        };

        lspWebSocket = webSocket;
      };

      start();

      return () => {
        currentEditor?.dispose();
      };
    }

    window.onbeforeunload = () => {
      // On page reload/exit, close web socket connection
      lspWebSocket?.close();
    };
    return () => {
      // On component unmount, close web socket connection
      lspWebSocket?.close();
    };
  }, []);

  return (
    <div
      ref={ref}
      style={{
        height: "100vh",
      }}
    />
  );
}
