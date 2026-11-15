// Controlled entrypoint source. Run only under a qualified process-owner broker,
// with a private project/../output and project/../candidate. This code is NOT an
// OS sandbox, license broker, tool receipt, quality assertion or active adapter.
using System;
using System.IO;
using System.Linq;
using System.Text;
using UnityEngine;
using UnityEditor;
using UnityEditor.Build.Reporting;

namespace Companion.GameProduction
{
    public static class WebBuild
    {
        const string Version = "6000.3.28f1";
        [Serializable] sealed class Settings
        {
            public int schemaVersion;
            public string engineVersion;
            public string dimension;
            public string[] scenes;
        }
        [Serializable] sealed class Result
        {
            public int schemaVersion = 1;
            public string engineVersion = Version;
            public string target = "web";
            public string result;
            public string failureCode;
            public int sceneCount;
            public int errors;
            public int warnings;
            public ulong bytes;
        }

        static string ReadBounded(string file, long limit)
        {
            var info = new FileInfo(file);
            if (!info.Exists || info.Length < 1 || info.Length > limit || (info.Attributes & FileAttributes.ReparsePoint) != 0)
                throw new InvalidDataException();
            return File.ReadAllText(file, new UTF8Encoding(false, true));
        }
        static bool ScenePath(string value)
        {
            if (String.IsNullOrEmpty(value) || value.Length > 400 || !value.StartsWith("Assets/", StringComparison.Ordinal) || !value.EndsWith(".unity", StringComparison.Ordinal)) return false;
            if (value.Any(c => c < 32 || c == 127 || "\\:?#%<>\"|*".IndexOf(c) >= 0) || !value.IsNormalized(NormalizationForm.FormC)) return false;
            return value.Split('/').All(part => part.Length > 0 && part != "." && part != ".." && !part.EndsWith(".") && !part.EndsWith(" "));
        }
        static void Publish(string directory, Result value)
        {
            Directory.CreateDirectory(directory);
            var destination = Path.Combine(directory, "unity-build.json");
            var temporary = destination + ".pending";
            var bytes = new UTF8Encoding(false, true).GetBytes(JsonUtility.ToJson(value) + "\n");
            using (var stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            {
                stream.Write(bytes, 0, bytes.Length);
                stream.Flush(true);
            }
            File.Move(temporary, destination); // Never overwrite an earlier candidate.
        }

        // Fixed -executeMethod Companion.GameProduction.WebBuild.Run. The caller
        // must select -buildTarget WebGL BEFORE project import. No arbitrary
        // execute method, scene fallback, output path or CLI is accepted here.
        public static void Run()
        {
            var project = Path.GetFullPath(Path.Combine(Application.dataPath, ".."));
            var work = Directory.GetParent(project).FullName;
            var output = Path.Combine(work, "output");
            var candidate = Path.Combine(work, "candidate");
            var result = new Result { result = "failed", failureCode = "invalid-project" };
            int exit = 1;
            try
            {
                if (Application.unityVersion != Version || !Application.isBatchMode) throw new InvalidDataException();
                if (EditorUserBuildSettings.activeBuildTarget != BuildTarget.WebGL) { result.failureCode = "wrong-target"; throw new InvalidDataException(); }
                var settings = JsonUtility.FromJson<Settings>(ReadBounded(Path.Combine(project, "game.unity.json"), 16384));
                if (settings == null || settings.schemaVersion != 1 || settings.engineVersion != Version || (settings.dimension != "2d" && settings.dimension != "3d") || settings.scenes == null || settings.scenes.Length < 1 || settings.scenes.Length > 128)
                    throw new InvalidDataException();
                if (settings.scenes.Distinct(StringComparer.OrdinalIgnoreCase).Count() != settings.scenes.Length || settings.scenes.Any(value => !ScenePath(value))) throw new InvalidDataException();
                foreach (var scene in settings.scenes)
                    if (AssetDatabase.LoadAssetAtPath<SceneAsset>(scene) == null) throw new InvalidDataException();
                result.sceneCount = settings.scenes.Length;
                if (File.Exists(Path.Combine(candidate, "unity-build.json")) || File.Exists(Path.Combine(candidate, "unity-build.json.pending")) || Directory.Exists(output) && Directory.EnumerateFileSystemEntries(output).Any())
                    throw new InvalidDataException();
                Directory.CreateDirectory(output);
                PlayerSettings.WebGL.threadsSupport = false;
                PlayerSettings.WebGL.compressionFormat = WebGLCompressionFormat.Disabled;
                PlayerSettings.WebGL.decompressionFallback = false;
                PlayerSettings.WebGL.dataCaching = false;
                PlayerSettings.WebGL.nameFilesAsHashes = false;
                PlayerSettings.WebGL.template = "APPLICATION:Minimal";
                result.failureCode = "export-failed";
                var report = BuildPipeline.BuildPlayer(new BuildPlayerOptions {
                    scenes = settings.scenes,
                    target = BuildTarget.WebGL,
                    locationPathName = output,
                    options = BuildOptions.StrictMode
                });
                if (report == null) throw new InvalidDataException();
                result.errors = report.summary.totalErrors;
                result.warnings = report.summary.totalWarnings;
                result.bytes = report.summary.totalSize;
                if (report.summary.result != BuildResult.Succeeded) throw new InvalidDataException();
                result.failureCode = "export-output";
                var build = Path.Combine(output, "Build");
                foreach (var suffix in new[] { ".loader.js", ".framework.js", ".wasm", ".data" })
                    if (!Directory.Exists(build) || Directory.GetFiles(build, "*" + suffix, SearchOption.TopDirectoryOnly).Length != 1) throw new InvalidDataException();
                if (!File.Exists(Path.Combine(output, "index.html"))) throw new InvalidDataException();
                result.result = "succeeded";
                result.failureCode = "";
                exit = 0;
            }
            catch (Exception)
            {
                // No exception, paths, source or provider/license content in the
                // bounded diagnostic. The outer broker owns logs and authority.
                Debug.LogError("Companion controlled Unity export failed.");
            }
            try { Publish(candidate, result); }
            catch (Exception) { exit = 1; Debug.LogError("Companion Unity candidate could not be acknowledged."); }
            EditorApplication.Exit(exit);
        }
    }
}
