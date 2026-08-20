package lab.packetcapture;

import java.lang.instrument.Instrumentation;
import java.nio.file.Path;
import java.nio.file.Files;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.util.Map;
import java.util.Set;
import java.util.jar.JarFile;

public final class PacketAgent {
  private PacketAgent() {}

  public static void agentmain(String options, Instrumentation instrumentation) throws Exception {
    Path output = Path.of(options == null || options.isBlank() ? "decrypted-packets.jsonl" : options)
      .toAbsolutePath();
    try {
      start(output, instrumentation);
    } catch (Throwable error) {
      PacketLog.status("agent_error", error.toString().replace('"', '\''));
      StringWriter details = new StringWriter();
      error.printStackTrace(new PrintWriter(details));
      Files.writeString(Path.of(output + ".error.log"), details.toString());
      if (error instanceof Exception exception) throw exception;
      throw new RuntimeException(error);
    }
  }

  private static void start(Path output, Instrumentation instrumentation) throws Exception {
    Path agentJar = Path.of(PacketAgent.class.getProtectionDomain().getCodeSource().getLocation().toURI());
    instrumentation.appendToSystemClassLoaderSearch(new JarFile(agentJar.toFile()));
    Module javaBase = Object.class.getModule();
    Module agentModule = PacketAgent.class.getModule();
    instrumentation.redefineModule(
      javaBase,
      Set.of(),
      Map.of("jdk.internal.org.objectweb.asm", Set.of(agentModule)),
      Map.of(),
      Set.of(),
      Map.of()
    );
    PacketLog.open(output);
    PacketTransformer transformer = new PacketTransformer();
    instrumentation.addTransformer(transformer, true);
    Set<String> targets = Set.of("f.hU", "f.SA0", "f.Y80");
    int attached = 0;
    for (Class<?> loadedClass : instrumentation.getAllLoadedClasses()) {
      if (targets.contains(loadedClass.getName()) && instrumentation.isModifiableClass(loadedClass)) {
        instrumentation.retransformClasses(loadedClass);
        PacketLog.status("attached", loadedClass.getName());
        attached += 1;
      }
    }
    if (attached == 0) throw new IllegalStateException("No protocol connection classes could be retransformed");
  }
}
