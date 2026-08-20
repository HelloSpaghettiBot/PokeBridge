package lab.packetcapture;

import java.io.BufferedWriter;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.time.Instant;

public final class PacketLog {
  private static BufferedWriter writer;

  private PacketLog() {}

  static synchronized void open(Path output) throws IOException {
    Path parent = output.getParent();
    if (parent != null) Files.createDirectories(parent);
    writer = Files.newBufferedWriter(
      output,
      StandardCharsets.UTF_8,
      StandardOpenOption.CREATE,
      StandardOpenOption.APPEND
    );
  }

  public static void outbound(ByteBuffer source, String protocolClass) {
    packet("client_to_server", protocolClass, source, false);
  }

  public static void inbound(ByteBuffer source, String protocolClass) {
    packet("server_to_client", protocolClass, source, true);
  }

  static synchronized void status(String type, String value) {
    write("{\"timestamp\":\"" + Instant.now() + "\",\"type\":\"" + type + "\",\"value\":\"" + value + "\"}");
  }

  private static synchronized void packet(String direction, String protocolClass, ByteBuffer source, boolean remainingOnly) {
    try {
      ByteBuffer copy = source.duplicate();
      byte[] bytes;
      if (remainingOnly) {
        byte[] body = new byte[copy.remaining()];
        copy.get(body);
        bytes = new byte[body.length + 2];
        System.arraycopy(body, 0, bytes, 2, body.length);
      } else {
        copy.position(0);
        bytes = new byte[copy.limit()];
        copy.get(bytes);
      }
      if (bytes.length >= 2) {
        bytes[0] = (byte) (bytes.length & 0xff);
        bytes[1] = (byte) ((bytes.length >>> 8) & 0xff);
      }
      int opcode = bytes.length > 2 ? bytes[2] & 0xff : -1;
      write("{\"timestamp\":\"" + Instant.now() + "\",\"type\":\"plain_packet\",\"direction\":\""
        + direction + "\",\"protocolClass\":\"" + protocolClass + "\",\"length\":" + bytes.length
        + ",\"opcode\":" + opcode + ",\"dataHex\":\""
        + hex(bytes) + "\"}");
    } catch (RuntimeException ignored) {
      // Instrumentation must never interrupt the game networking thread.
    }
  }

  private static void write(String line) {
    if (writer == null) return;
    try {
      writer.write(line);
      writer.newLine();
      writer.flush();
    } catch (IOException ignored) {
      // Instrumentation must never interrupt the game networking thread.
    }
  }

  private static String hex(byte[] bytes) {
    char[] output = new char[bytes.length * 2];
    char[] digits = "0123456789abcdef".toCharArray();
    for (int index = 0; index < bytes.length; index++) {
      int value = bytes[index] & 0xff;
      output[index * 2] = digits[value >>> 4];
      output[index * 2 + 1] = digits[value & 0x0f];
    }
    return new String(output);
  }
}
