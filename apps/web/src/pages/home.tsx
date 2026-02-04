import { ModeToggle } from "@/components/mode-toggle";
import { useTheme } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { Spinner } from "@/components/ui/spinner";
import { environment } from "@/environment";
import { Editor } from "@monaco-editor/react";
import { PlayIcon } from "lucide-react";
import { useEffect, useState } from "react";

type APIExecuteRequest = {
  language: string;
  code: string;
};

type APIExecuteResponse = {
  jobId: string;
};

type Languages = "go" | "javascript" | "typescript" | "csharp";

type Language = {
  value: Languages;
  label: string;
};

const languages: Language[] = [
  {
    value: "typescript",
    label: "TypeScript",
  },
  {
    value: "javascript",
    label: "JavaScript",
  },
  {
    value: "go",
    label: "Go",
  },
  {
    value: "csharp",
    label: "C#",
  },
];

const code_snippets: Record<Languages, string> = {
  javascript: `function main(props) {\r\n    console.log(\`Hello \${props.message}\`)\r\n}\r\n\r\nmain({ message: \"World\" })`,
  typescript: `type Props = {\r\n    message: string;\r\n}\r\n\r\nfunction main(props: Props) {\r\n    console.log(\`Hello \${props.message}\`)\r\n}\r\n\r\nmain({ message: \"World\" })`,
  go: `package main\r\n\r\nimport "fmt"\r\n\r\nfunc main() {\r\n    fmt.Println("Hello, World")\r\n}`,
  csharp: `Console.WriteLine("Hello, World");`,
};

export function Home() {
  const [code, setCode] = useState<string>(code_snippets["typescript"]);
  const [selectedLanguage, setSelectedLanguage] = useState<Language>(
    languages.find((x) => x.value === "typescript") ?? languages[0],
  );
  const { theme } = useTheme();
  const [isLoading, setIsLoading] = useState(false);
  const [output, setOutput] = useState<string[]>([
    "Click 'Run' to view the output.",
  ]);

  useEffect(() => {
    setCode(code_snippets[selectedLanguage.value]);
  }, [selectedLanguage]);

  const handleOnRunClick = async () => {
    setIsLoading(true);
    setOutput([]);

    const response = await fetch(
      `${environment.VITE_API_BASE_URL}/api/v1/execute`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          language: selectedLanguage.value,
          code,
        } satisfies APIExecuteRequest),
      },
    );

    if (!response.ok) {
      setIsLoading(false);
      setOutput([await response.text()]);
      return;
    }

    const { jobId } = (await response.json()) as APIExecuteResponse;
    const events = new EventSource(
      `${environment.VITE_API_BASE_URL}/api/v1/jobs/${jobId}/stream`,
    );
    events.addEventListener("stdout", (e) => {
      setOutput((prev) => [...prev, e.data]);
    });

    events.addEventListener("stderr", (e) => {
      setOutput((prev) => [...prev, e.data]);
    });

    events.addEventListener("end", () => {
      events.close();
      setIsLoading(false);
    });

    events.onerror = () => {
      events.close();
      setIsLoading(false);
      setOutput((prev) => [...prev, "Error: Connection lost."]);
    };
  };

  return (
    <main className="p-4 flex flex-col gap-2 h-screen">
      <div className="flex justify-between">
        <div className="flex gap-2">
          <Combobox
            items={languages}
            value={selectedLanguage}
            onValueChange={(language) =>
              language && setSelectedLanguage(language)
            }
          >
            <ComboboxInput
              placeholder="Select a language"
              className="w-[200px]"
            />
            <ComboboxContent>
              <ComboboxEmpty>No items found.</ComboboxEmpty>
              <ComboboxList>
                {(language: Language) => (
                  <ComboboxItem key={language.value} value={language}>
                    {language.label}
                  </ComboboxItem>
                )}
              </ComboboxList>
            </ComboboxContent>
          </Combobox>

          <Button
            variant="outline"
            onClick={handleOnRunClick}
            disabled={isLoading || !selectedLanguage}
          >
            {isLoading ? <Spinner data-icon="inline-start" /> : <PlayIcon />}
            Run
          </Button>
        </div>

        <ModeToggle />
      </div>
      <ResizablePanelGroup direction="horizontal">
        <ResizablePanel>
          <Editor
            height="100%"
            theme={theme === "dark" ? "vs-dark" : "light"}
            language={selectedLanguage.value}
            value={code}
            onChange={(value) => setCode(value ?? "")}
            beforeMount={(monaco) => {
              // Full monaco namespace access
              // Register language clients here (future LSP)
            }}
            onMount={(editor, monaco) => {
              // Full editor instance access
              // Attach language client to editor (future LSP)
            }}
          />
        </ResizablePanel>
        <ResizableHandle className="w-2 bg-inherit" />
        <ResizablePanel className="border p-2 text-muted-foreground">
          {isLoading ? (
            <>Running...</>
          ) : (
            output.map((line, i) => <div key={i}>{line}</div>)
          )}
        </ResizablePanel>
      </ResizablePanelGroup>
    </main>
  );
}
