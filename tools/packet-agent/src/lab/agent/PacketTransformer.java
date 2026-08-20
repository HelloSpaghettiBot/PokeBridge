package lab.packetcapture;

import java.lang.instrument.ClassFileTransformer;
import java.security.ProtectionDomain;
import jdk.internal.org.objectweb.asm.ClassReader;
import jdk.internal.org.objectweb.asm.ClassVisitor;
import jdk.internal.org.objectweb.asm.ClassWriter;
import jdk.internal.org.objectweb.asm.MethodVisitor;
import jdk.internal.org.objectweb.asm.Opcodes;

final class PacketTransformer implements ClassFileTransformer {
  private static final String BUFFER_DESCRIPTOR = "(Ljava/nio/ByteBuffer;)";

  @Override
  public byte[] transform(
    ClassLoader loader,
    String className,
    Class<?> classBeingRedefined,
    ProtectionDomain protectionDomain,
    byte[] classfileBuffer
  ) {
    if (!("f/hU".equals(className) || "f/SA0".equals(className) || "f/Y80".equals(className))) return null;
    ClassReader reader = new ClassReader(classfileBuffer);
    ClassWriter writer = new ClassWriter(reader, ClassWriter.COMPUTE_MAXS);
    ClassVisitor visitor = new ClassVisitor(Opcodes.ASM8, writer) {
      @Override
      public MethodVisitor visitMethod(int access, String name, String descriptor, String signature, String[] exceptions) {
        MethodVisitor delegate = super.visitMethod(access, name, descriptor, signature, exceptions);
        return new MethodVisitor(Opcodes.ASM8, delegate) {
          @Override
          public void visitMethodInsn(int opcode, String owner, String calledName, String calledDescriptor, boolean isInterface) {
            if (opcode == Opcodes.INVOKEVIRTUAL
              && owner.equals("f/c90")
              && calledName.equals("wC1")
              && calledDescriptor.equals(BUFFER_DESCRIPTOR + "I")) {
              visitInsn(Opcodes.DUP);
              visitLdcInsn(className.replace('/', '.'));
              super.visitMethodInsn(
                Opcodes.INVOKESTATIC,
                "lab/packetcapture/PacketLog",
                "outbound",
                "(Ljava/nio/ByteBuffer;Ljava/lang/String;)V",
                false
              );
            }
            super.visitMethodInsn(opcode, owner, calledName, calledDescriptor, isInterface);
            if (opcode == Opcodes.INVOKEVIRTUAL
              && owner.equals("f/c90")
              && calledName.equals("qr0")
              && calledDescriptor.equals(BUFFER_DESCRIPTOR + "Z")) {
              visitVarInsn(Opcodes.ALOAD, 1);
              visitLdcInsn(className.replace('/', '.'));
              super.visitMethodInsn(
                Opcodes.INVOKESTATIC,
                "lab/packetcapture/PacketLog",
                "inbound",
                "(Ljava/nio/ByteBuffer;Ljava/lang/String;)V",
                false
              );
            }
          }
        };
      }
    };
    reader.accept(visitor, 0);
    return writer.toByteArray();
  }
}
