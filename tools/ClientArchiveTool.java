import java.io.BufferedWriter;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;

public final class ClientArchiveTool {
  public static void main(String[] args) throws Exception {
    if (args.length < 1) usage();
    switch (args[0]) {
      case "scan" -> scan(args);
      case "extract" -> extract(args);
      default -> usage();
    }
  }

  private static void scan(String[] args) throws IOException {
    if (args.length < 4) usage();
    Path archive = Path.of(args[1]);
    Path output = Path.of(args[2]);
    List<byte[]> patterns = Arrays.stream(args).skip(3)
      .map(value -> value.getBytes(StandardCharsets.ISO_8859_1))
      .toList();
    Files.createDirectories(output.toAbsolutePath().getParent());

    try (ZipFile zip = new ZipFile(archive.toFile());
         BufferedWriter writer = Files.newBufferedWriter(output, StandardCharsets.UTF_8)) {
      var entries = zip.entries();
      while (entries.hasMoreElements()) {
        ZipEntry entry = entries.nextElement();
        if (!entry.getName().endsWith(".class")) continue;
        byte[] bytes = zip.getInputStream(entry).readAllBytes();
        List<String> matches = new ArrayList<>();
        for (int index = 3; index < args.length; index++) {
          if (contains(bytes, patterns.get(index - 3))) matches.add(args[index]);
        }
        if (!matches.isEmpty()) {
          writer.write(entry.getName());
          writer.write('\t');
          writer.write(String.join(",", matches));
          writer.newLine();
        }
      }
    }
  }

  private static void extract(String[] args) throws IOException {
    if (args.length != 4) usage();
    Path archive = Path.of(args[1]);
    String entryName = args[2];
    Path output = Path.of(args[3]);
    Files.createDirectories(output.toAbsolutePath().getParent());
    try (ZipFile zip = new ZipFile(archive.toFile())) {
      ZipEntry entry = zip.getEntry(entryName);
      if (entry == null) throw new IOException("Archive entry not found: " + entryName);
      Files.write(output, zip.getInputStream(entry).readAllBytes());
    }
  }

  private static boolean contains(byte[] bytes, byte[] pattern) {
    outer: for (int offset = 0; offset <= bytes.length - pattern.length; offset++) {
      for (int index = 0; index < pattern.length; index++) {
        if (bytes[offset + index] != pattern[index]) continue outer;
      }
      return true;
    }
    return false;
  }

  private static void usage() {
    throw new IllegalArgumentException("Usage: ClientArchiveTool scan ARCHIVE OUT PATTERN... | extract ARCHIVE ENTRY OUT");
  }
}
