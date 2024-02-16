import { ThemeProvider } from "@/providers/theme-provider";
import { CodeEditor } from "./components/code-editor";
import { Button } from "./components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
} from "./components/ui/command";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "./components/ui/popover";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "./components/ui/resizable";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "./components/ui/select";
import { cn } from "./lib/utils";
import { useState } from "react";
import { CaretSortIcon, CheckIcon, ReloadIcon } from "@radix-ui/react-icons";
import { ThemeToggle } from "./components/theme-toggle";
import { editor } from "monaco-editor";

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
  javascript: `function main(props) {\r\n    console.log(\`Hello \${props.message}\`)\r\n}\r\n\r\nmain({ message: "World" })`,
  typescript: `type Props = {\r\n    message: string;\r\n}\r\n\r\nfunction main(props: Props) {\r\n    console.log(\`Hello \${props.message}\`)\r\n}\r\n\r\nmain({ message: "World" })`,
  go: 'package main\n\nimport "fmt"\n\nfunc main() {\n\tfmt.Println("hello world")\n}',
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

function App() {
  const [open, setOpen] = useState(false);
  const [orientation, setOrientation] = useState<Orientation>("horizontal");

  const [isLoading, setIsLoading] = useState(false);
  const [isError, setIsError] = useState(false);

  const [selectedLanguage, setSelectedLanguage] = useState("go");
  const [output, setOutput] = useState<string[]>([
    "Click 'Run' to view the output.",
  ]);
  const [editor, setEditor] = useState<editor.IStandaloneCodeEditor>();

  const handleOnRunClick = async () => {
    const code = editor?.getValue();

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
      const json = await response.json();
      setOutput([`Error: ${json.message}`]);
      setIsError(true);
      return;
    }

    const json = await response.json();

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

  return (
    <ThemeProvider>
      <main className="p-4 flex flex-col gap-2 min-h-screen">
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
                            currentValue === selectedLanguage
                              ? ""
                              : currentValue
                          );
                          editor?.setValue(code_snippets[currentValue]);
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
            <CodeEditor
              defaultCode={code_snippets["go"]}
              setEditor={setEditor}
            />
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
      </main>
    </ThemeProvider>
  );
}

export default App;
