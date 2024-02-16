"use client";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { Editor, EditorProps, useMonaco } from "@monaco-editor/react";
import { CaretSortIcon, CheckIcon, ReloadIcon } from "@radix-ui/react-icons";
import {
  Command,
  CommandInput,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import { createRef, useEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { ThemeToggle } from "../../src/components/theme-toggle";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSearchParams } from "next/navigation";
import { MonacoLanguageClient, initServices } from "monaco-languageclient";
import {
  WebSocketMessageReader,
  WebSocketMessageWriter,
  listen,
  toSocket,
} from "vscode-ws-jsonrpc";
import * as monaco from "monaco-editor";
import * as vscode from "vscode";
import {
  CloseAction,
  ErrorAction,
  MessageTransports,
} from "vscode-languageclient";
import { MessageConnection } from "vscode-jsonrpc";
import {
  RegisteredFileSystemProvider,
  registerFileSystemOverlay,
  RegisteredMemoryFile,
} from "@codingame/monaco-vscode-files-service-override";
import { createConfiguredEditor, createModelReference } from "vscode/monaco";

const language_versions: Record<string, string> = {
  javascript: "18.15.0",
  typescript: "5.0.3",
  go: "1.16.2",
};

const languages = [
  {
    value: "javascript",
    label: "JavaScript",
  },
  {
    value: "typescript",
    label: "TypeScript",
  },
  {
    value: "go",
    label: "Go",
  },
];

type Orientation = "horizontal" | "vertical";

const code_snippets: Record<string, string> = {
  javascript: `function main(props) {\r\n    console.log(\`Hello \${props.message}\`)\r\n}\r\n\r\nmain({ message: \"World\" })`,
  typescript: `type Props = {\r\n    message: string;\r\n}\r\n\r\nfunction main(props: Props) {\r\n    console.log(\`Hello \${props.message}\`)\r\n}\r\n\r\nmain({ message: \"World\" })`,
};

type PrisonAPIResponse = {
  language: string;
  verison: string;
  run: {
    stdout: string;
    stderr: string;
    code: number;
    output: string;
  };
  compile?: {
    stdout: string;
    stderr: string;
    code: number;
    output: string;
  };
};

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

export function CodeEditor({ ...props }: EditorProps) {
  const searchParams = useSearchParams();
  const { resolvedTheme } = useTheme();
  const [code, setCode] = useState<string>(
    atob(searchParams.get("code") ?? "") || code_snippets["typescript"]
  );
  const [open, setOpen] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState(
    searchParams.get("language") || "typescript"
  );
  const [output, setOutput] = useState<string[]>([
    "Click 'Run' to view the output.",
  ]);
  const [orientation, setOrientation] = useState<Orientation>("horizontal");
  const [isLoading, setIsLoading] = useState(false);
  const [isError, setIsError] = useState(false);

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
        await createJsonEditor({
          htmlElement: ref.current!,
          content:
            'package main\n\nimport "fmt"\n\nfunc main() {\n\tfmt.Println("hello world")\n}',
        });
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

  useEffect(() => {
    const orientation =
      typeof window !== "undefined"
        ? window.localStorage.getItem("orientation")
        : "";
    if (orientation) {
      setOrientation(orientation === "vertical" ? "vertical" : "horizontal");
    }

    //
    // init
    //

    // async function init() {
    //   setTimeout(async () => {
    //     console.log("initializing");
    //     await initServices();

    //     const fileSystemProvider = new RegisteredFileSystemProvider(false);
    //     fileSystemProvider.registerFile(
    //       new RegisteredMemoryFile(
    //         vscode.Uri.file("/workspace/main.go"),
    //         'package main\n\nimport "fmt"\n\nfunc main() {\n\tfmt.Println("hello world")\n}'
    //       )
    //     );
    //     registerFileSystemOverlay(1, fileSystemProvider);

    //     const modelRef = await createModelReference(
    //       monaco.Uri.file("/workspace/main.go")
    //     );
    //     modelRef.object.setLanguageId("go");

    //     console.log("configuring editor");
    //     createConfiguredEditor(document.getElementById("container")!, {
    //       model: modelRef.object.textEditorModel,
    //       automaticLayout: true,
    //     });

    //     const webSocket = new WebSocket(
    //       "wss://hrc.suggest.hackerrank.com/go?user_id=undefined"
    //     );
    //     webSocket.onopen = async () => {
    //       const socket = toSocket(webSocket);
    //       const reader = new WebSocketMessageReader(socket);
    //       const writer = new WebSocketMessageWriter(socket);
    //       const languageClient = createLanguageClient({
    //         reader,
    //         writer,
    //       });
    //       await languageClient.start();
    //       reader.onClose(() => languageClient.stop());
    //     };
    //   }, 1_000);
    // }

    // init();
  }, []);

  // client?.languages.registerHoverProvider("go", {
  //   provideHover(model, position, token) {
  //     console.log(model.getWordAtPosition(position));

  //     return {
  //       range: new client.Range(1,1,1,4),
  //       contents: [{value: "test"}]
  //     }
  //   }
  // })

  const handleOnRunClick = async () => {
    setIsError(false);
    setIsLoading(true);

    const response = await fetch("https://emkc.org/api/v2/piston/execute", {
      method: "POST",
      body: JSON.stringify({
        language: selectedLanguage,
        version: language_versions[selectedLanguage],
        files: [
          {
            name: "main",
            content: code,
          },
        ],
      }),
    });

    setIsLoading(false);

    if (!response.ok) {
      const json = await response.json<{ message: string }>();
      setOutput([`Error: ${json.message}`]);
      setIsError(true);
      return;
    }

    const json = await response.json<PrisonAPIResponse>();

    if (json.compile && json.compile.code > 0) {
      setOutput(json.compile.output.split("\n"));
      setIsError(true);
      return;
    }

    if (json.run.code > 0) {
      setIsError(true);
    }

    setOutput(json.run.output.split("\n"));
  };

  useEffect(() => {
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}?language=${selectedLanguage}&code=${btoa(
        code
      )}`
    );
  }, [code, selectedLanguage]);

  return (
    <>
      <div className="flex flex-col gap-2 sm:flex-row justify-between">
        <div className="flex gap-2">
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                aria-expanded={open}
                className="w-[200px] justify-between"
              >
                {selectedLanguage
                  ? languages.find(
                      (language) => language.value === selectedLanguage
                    )?.label
                  : "Select language..."}
                <CaretSortIcon className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[200px] p-0">
              <Command>
                <CommandInput
                  placeholder="Search language..."
                  className="h-9"
                />
                <CommandEmpty>No language found.</CommandEmpty>
                <CommandGroup>
                  {languages.map((language) => (
                    <CommandItem
                      key={language.value}
                      value={language.value}
                      onSelect={(currentValue) => {
                        setSelectedLanguage(
                          currentValue === selectedLanguage ? "" : currentValue
                        );
                        setCode(code_snippets[currentValue]);
                        setOpen(false);
                      }}
                    >
                      {language.label}
                      <CheckIcon
                        className={cn(
                          "ml-auto h-4 w-4",
                          selectedLanguage === language.value
                            ? "opacity-100"
                            : "opacity-0"
                        )}
                      />
                    </CommandItem>
                  ))}
                </CommandGroup>
              </Command>
            </PopoverContent>
          </Popover>

          <Button
            className="w-16"
            variant="outline"
            onClick={handleOnRunClick}
            disabled={isLoading || !selectedLanguage}
          >
            {isLoading ? (
              <ReloadIcon className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              "Run"
            )}
          </Button>
        </div>

        <div className="flex gap-2">
          <Select
            value={orientation}
            onValueChange={(value) => {
              setOrientation(value as Orientation);
              window.localStorage.setItem("orientation", value);
            }}
          >
            <SelectTrigger className="flex-1 w-[180px]">
              <SelectValue placeholder="Orientation" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="horizontal">Horizontal</SelectItem>
              <SelectItem value="vertical">Vertical</SelectItem>
            </SelectContent>
          </Select>

          <ThemeToggle />
        </div>
      </div>

      <ResizablePanelGroup direction={orientation} className="flex-1">
        <ResizablePanel>
          <div ref={ref} className="h-full"></div>
          {/* <Editor
            height="100%"
            theme={resolvedTheme === "dark" ? "vs-dark" : "light"}
            language={selectedLanguage}
            defaultValue="// some comment"
            value={code}
            onChange={(value) => setCode(value ?? "")}
            {...props}
          /> */}
        </ResizablePanel>
        <ResizableHandle className="w-2 bg-inherit" />
        <ResizablePanel>
          <div
            className={cn(
              "h-full border border-sm p-2 text-muted-foreground",
              isError && "text-red-400"
            )}
          >
            {isLoading ? (
              <div className="flex items-center justify-center h-full">
                <ReloadIcon className="mr-2 h-4 w-4 animate-spin" />
                Executing...
              </div>
            ) : !selectedLanguage ? (
              <p>Please select a language to get started.</p>
            ) : (
              output.map((line, index) => <p key={index}>{line}</p>)
            )}
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </>
  );
}
